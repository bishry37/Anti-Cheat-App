import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Setting, Subject, Exam, StudentSession } from '../types';
import { ShieldAlert, UserPlus, Lock, AppWindow, GraduationCap, ArrowRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import brandLogo from '../assets/images/anti_cheating_logo_1780567204620.png';

export default function Home() {
  const navigate = useNavigate();
  const { user, isAdmin, loginAsStudent } = useAuth();
  const [activeTab, setActiveTab] = useState<'student' | 'admin'>('student');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Data
  const [setting, setSetting] = useState<Setting | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeExams, setActiveExams] = useState<Exam[]>([]);

  // Form State
  const [studentName, setStudentName] = useState('');
  const [className, setClassName] = useState(''); // Need class name for student session
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [examToken, setExamToken] = useState('');
  
  // Admin Form State
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  useEffect(() => {
    if (user) {
      if (isAdmin) {
        navigate('/admin');
      } else {
        navigate('/exam'); // Automatically goes to exam room
      }
    }
  }, [user, isAdmin, navigate]);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch Settings
        const settingsSnap = await getDocs(collection(db, 'settings'));
        if (!settingsSnap.empty) {
          setSetting(settingsSnap.docs[0].data() as Setting);
        }

        // Fetch Subjects
        const subjectsSnap = await getDocs(collection(db, 'subjects'));
        setSubjects(subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject)));

        // Fetch Active Exams
        const examsQuery = query(collection(db, 'exams'), where('isActive', '==', true));
        const examsSnap = await getDocs(examsQuery);
        setActiveExams(examsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam)));
      } catch (err) {
        console.error(err);
      }
    }
    fetchData();
  }, []);

  // Background token auto-reset check
  useEffect(() => {
    if (activeExams.length === 0) return;

    const generateNewToken = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let t = '';
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 100) {
        t = '';
        for (let i = 0; i < 6; i++) {
          t += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        isUnique = !activeExams.some(e => e.isActive && e.activeToken === t);
        attempts++;
      }
      return t;
    };

    const checkAndResetTokens = async () => {
      let changed = false;
      const newList = [...activeExams];

      for (let i = 0; i < newList.length; i++) {
        const exam = newList[i];
        if (exam.isActive && exam.autoResetInterval && exam.autoResetInterval !== 'manual') {
          const intervalMinutes = parseInt(exam.autoResetInterval, 10);
          if (!isNaN(intervalMinutes)) {
            const lastUpdated = exam.tokenUpdatedAt || 0;
            const elapsedMs = Date.now() - lastUpdated;
            const limitMs = intervalMinutes * 60 * 1000;

            if (elapsedMs >= limitMs) {
              const newToken = generateNewToken();
              const now = Date.now();
              try {
                await updateDoc(doc(db, 'exams', exam.id!), {
                  activeToken: newToken,
                  tokenUpdatedAt: now
                });
                newList[i] = {
                  ...exam,
                  activeToken: newToken,
                  tokenUpdatedAt: now
                };
                changed = true;
              } catch (err) {
                console.error("Gagal melakukan reset otomatis token:", err);
              }
            }
          }
        }
      }

      if (changed) {
        setActiveExams(newList);
      }
    };

    checkAndResetTokens();
    const interval = setInterval(checkAndResetTokens, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [activeExams]);

  const handleAdminEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmail || !adminPassword) {
      setErrorMessage('Harap isi Email dan Password.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      // Let onAuthStateChanged handle navigation
    } catch (error: any) {
      console.error(error);
      setErrorMessage('Email atau Password salah.');
      setLoading(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName || !className || !selectedSubjectId || !examToken) {
      setErrorMessage('Harap lengkapi semua data.');
      return;
    }

    // Validate credentials against active exams
    const matchingExam = activeExams.find(
      (ex) => ex.subjectId === selectedSubjectId && ex.activeToken === examToken
    );

    if (!matchingExam) {
      setErrorMessage('Token ujian salah atau ujian tidak tersedia untuk mapel ini.');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');
      const uid = await loginAsStudent();

      const sessionData: StudentSession = {
        studentName,
        className,
        examId: matchingExam.id!,
        subjectId: selectedSubjectId,
        token: examToken,
        status: 'Aktif',
        violationsCount: 0,
        lastActivity: Date.now(),
        startTime: Date.now()
      };

      await setDoc(doc(db, 'student_sessions', uid), sessionData);

      // Now it will redirect naturally via useEffect.
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memulai ujian.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-50 rounded-full blur-[100px] opacity-50 pointer-events-none -z-0"></div>

      <div className="w-full max-w-md bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 sm:p-10 relative z-10">
        
        {/* Top Branding Section */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-24 h-24 bg-white border border-slate-200 shadow-md rounded-[1.25rem] p-3 flex items-center justify-center mb-5 overflow-hidden">
            {setting?.schoolLogo ? (
              <img src={setting.schoolLogo} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <img 
                src={brandLogo} 
                alt="Anti Cheating App Logo" 
                className="w-full h-full object-contain" 
                referrerPolicy="no-referrer"
              />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {setting?.schoolName || 'Anti Cheating App'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm px-4">
            {setting?.schoolSlogan || 'Sistem Ujian Online yang memonitor aktivitas secara real-time dan menjamin integritas.'}
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl mb-8 border border-slate-200/60 shadow-inner">
          <button
            onClick={() => setActiveTab('student')}
            className={`flex-1 py-2.5 text-xs font-bold tracking-wide uppercase rounded-lg transition-all duration-200 ${
              activeTab === 'student' ? 'bg-white text-blue-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Siswa
          </button>
          <button
            onClick={() => setActiveTab('admin')}
            className={`flex-1 py-2.5 text-xs font-bold tracking-wide uppercase rounded-lg transition-all duration-200 ${
              activeTab === 'admin' ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Admin
          </button>
        </div>

        {errorMessage && (
          <div className="mb-8 p-3.5 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm justify-center flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        <div className="relative">
          <AnimatePresence mode="wait">
            {activeTab === 'student' ? (
              <motion.form 
                key="student"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
                onSubmit={handleStudentLogin}
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nama Lengkap</label>
                    <input 
                      type="text" 
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="Contoh: Budi Santoso"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Kelas</label>
                    <input 
                      type="text" 
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      placeholder="Contoh: XII IPA 1"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Mata Pelajaran</label>
                    <select 
                      value={selectedSubjectId}
                      onChange={(e) => setSelectedSubjectId(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer focus:bg-white text-sm font-medium"
                    >
                      <option value="" disabled className="text-slate-400">--- Pilih Mata Pelajaran ---</option>
                      {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Token Ujian</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input 
                        type="text" 
                        value={examToken}
                        onChange={(e) => setExamToken(e.target.value)}
                        placeholder="Masukkan 6 digit token"
                        className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono uppercase tracking-widest font-bold text-slate-700 focus:bg-white text-sm"
                        maxLength={6}
                      />
                    </div>
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-8 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      <span>MULAI UJIAN</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            ) : (
              <motion.form 
                key="admin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleAdminEmailLogin}
                className="space-y-5"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email</label>
                  <input 
                    type="email" 
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="email@sekolah.com"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Password</label>
                  <input 
                    type="password" 
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white font-bold tracking-wide py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shadow hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Login sebagai Admin</span>}
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer Motivation */}
      <div className="mt-12 max-w-lg w-full text-center space-y-4 text-slate-500 z-10 flex flex-col items-center">
        <p className="text-sm leading-relaxed font-serif italic px-6">
          "{setting?.motivationText || 'Kejujuran adalah prestasi yang paling berharga. Kerjakan ujian dengan kemampuan dan integritas terbaikmu.'}"
        </p>
      </div>
    </div>
  );
}
