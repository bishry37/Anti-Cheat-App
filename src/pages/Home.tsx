import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Setting, Subject, Exam, StudentSession } from '../types';
import { ShieldAlert, UserPlus, Lock, AppWindow, GraduationCap, ArrowRight, Loader2, UserCircle, KeyRound, CheckCircle2, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import brandLogo from '../assets/images/cheating.jpg';

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const examIdFromUrl = searchParams.get('e');
  const codeFromUrl = searchParams.get('c');
  const hasStudentLink = !!(examIdFromUrl || codeFromUrl);

  const { user, isAdmin, loginAsStudent, resetPassword, checkEmailExists } = useAuth();
  const [activeTab, setActiveTab] = useState<'student' | 'admin' | 'forgot_password'>('student');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Data
  const [setting, setSetting] = useState<Setting | null>(null);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeExams, setActiveExams] = useState<Exam[]>([]);
  const [classesList, setClassesList] = useState<{id: string, name: string}[]>([]);

  // Form State
  const [studentName, setStudentName] = useState('');
  const [examToken, setExamToken] = useState('');
  
  // Admin Form State
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');

  // Specific Exam info based on URL
  const [linkedExam, setLinkedExam] = useState<Exam | null>(null);
  const [linkedSubjectName, setLinkedSubjectName] = useState<string>('');

  useEffect(() => {
    // Only redirect if we haven't manually disabled auto-redirect in this tab
    if (user && !sessionStorage.getItem('skip_auto_redirect')) {
      if (isAdmin) {
        navigate('/admin');
      } else {
        navigate('/exam');
      }
    }
  }, [user, isAdmin, navigate]);

  useEffect(() => {
    let unsubSettings: () => void;
    let unsubExams: () => void;
    let unsubClasses: () => void;
    let unsubSubjects: () => void;

    // Fetch Active Exams
    const examsQuery = query(collection(db, 'exams'), where('isActive', '==', true));
    unsubExams = onSnapshot(examsQuery, (examsSnap) => {
      const examsData = examsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
      setActiveExams(examsData);
    }, (err) => console.error(err));

    // Fetch Classes
    unsubClasses = onSnapshot(collection(db, 'classes'), (classesSnap) => {
      const uniqueClasses = Array.from(new Map(classesSnap.docs.map(d => [d.data().name, { id: d.id, name: d.data().name }])).values());
      const sortedClasses = uniqueClasses.sort((a, b) => a.name.localeCompare(b.name));
      setClassesList(sortedClasses);
    }, (err) => console.error(err));

    // Fetch Subjects
    unsubSubjects = onSnapshot(collection(db, 'subjects'), (subjectsSnap) => {
      const rawSubjects = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject));
      setAllSubjects(rawSubjects);
      const uniqueSubjects = Array.from(new Map(rawSubjects.map(d => [d.name, d])).values());
      const sortedSubjects = uniqueSubjects.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setSubjects(sortedSubjects as Subject[]);
    }, (err) => console.error(err));

    return () => {
      if (unsubExams) unsubExams();
      if (unsubClasses) unsubClasses();
      if (unsubSubjects) unsubSubjects();
    };
  }, []);

  // Update linkedExam when data loaded
  useEffect(() => {
    const targetCode = codeFromUrl || examIdFromUrl;
    if (targetCode && activeExams.length > 0) {
      const ex = Array.isArray(activeExams) ? activeExams.find(e => 
         e.id === targetCode || 
         e.shortCode === targetCode || 
         e.id?.substring(0, 6) === targetCode
      ) : undefined;
      if (ex) {
        setLinkedExam(ex);
        const subj = Array.isArray(allSubjects) ? allSubjects.find(s => s.id === ex.subjectId) : undefined;
        if (subj) setLinkedSubjectName(subj.name);
      }
    }
  }, [examIdFromUrl, codeFromUrl, activeExams, allSubjects]);

  // Sync Settings when Admin is identified
  useEffect(() => {
    let adminId = '';
    
    // 1. Check linkedExam (from URL)
    if (linkedExam?.adminId) {
      adminId = linkedExam.adminId;
    } 
    // 2. Check token entry
    else if (examToken && examToken.length >= 4) {
      const matchingExam = Array.isArray(activeExams) ? activeExams.find(ex => ex.activeToken.toUpperCase() === examToken.toUpperCase()) : undefined;
      if (matchingExam?.adminId) {
        adminId = matchingExam.adminId;
      }
    }

    if (adminId) {
      const qSettings = query(collection(db, 'settings'), where('adminId', '==', adminId));
      const unsub = onSnapshot(qSettings, (snap) => {
        if (!snap.empty) {
          setSetting(snap.docs[0].data() as Setting);
        }
      });
      return () => unsub();
    }
  }, [linkedExam?.adminId, examToken, activeExams]);

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
        isUnique = !Array.isArray(activeExams) || !activeExams.some(e => e.isActive && e.activeToken === t);
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setErrorMessage('Harap masukkan alamat email.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      // Per the user request, if the email does not exist, throw an alert.
      const exists = await checkEmailExists(resetEmail);
      if (!exists) {
        setErrorMessage('Email yang dimasukkan tidak terdaftar.');
        setLoading(false);
        return;
      }
      
      await resetPassword(resetEmail);
      setSuccessMessage('Tautan reset password telah dikirim ke email Anda.');
      setResetEmail('');
    } catch (error: any) {
      console.error(error);
      setErrorMessage('Gagal mengirim tautan reset password atau email tidak terdaftar.');
    } finally {
      setLoading(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName || !examToken) {
      setErrorMessage('Harap lengkapi semua data.');
      return;
    }

    // Validate credentials against active exams
    const matchingExamByToken = Array.isArray(activeExams) ? activeExams.find(ex => ex.activeToken === examToken) : undefined;

    if (!matchingExamByToken) {
      setErrorMessage('Token ujian salah atau ujian tidak tersedia. Pastikan token yang Anda masukkan benar.');
      return;
    }

    // If they used a link to specific exam, verify the token matches that exam
    if (linkedExam && matchingExamByToken.id !== linkedExam.id) {
       setErrorMessage('Token ujian tidak cocok dengan link ujian ini.');
       return;
    }

    const matchingExam = matchingExamByToken;

    try {
      setLoading(true);
      setErrorMessage('');

      // Check for an existing session with exact same candidate name and exam
      const sessionQuery = query(
        collection(db, 'student_sessions'),
        where('examId', '==', matchingExam.id),
        where('studentName', '==', studentName),
        where('adminId', '==', matchingExam.adminId)
      );
      
      const sessionSnap = await getDocs(sessionQuery);
      let targetUid = '';
      let isResume = false;
      let existingSessionData: StudentSession | null = null;

      if (!sessionSnap.empty) {
        const docSnap = sessionSnap.docs[0];
        existingSessionData = docSnap.data() as StudentSession;
        targetUid = docSnap.id;
        isResume = true;

        // Validation for resuming
        if (existingSessionData.status === 'Selesai') {
          setErrorMessage('Anda sudah menyelesaikan ujian ini sebelumnya.');
          setLoading(false);
          return;
        }

        if (existingSessionData.status === 'Didiskualifikasi') {
          setErrorMessage('Akun Anda telah didiskualifikasi dari ujian ini.');
          setLoading(false);
          return;
        }
      }

      // Login to Firebase (Anonymous)
      const uid = await loginAsStudent();
      
      // If we found an existing session but the current auth UID is different,
      // we'll update the record to use the current UID or simply continue using the old document ID 
      // if we want to preserve answers.
      // Better: Use the name+exam as the basis. 
      // For simplicity and preventing duplicates, we will write to the found targetUid if it exists.
      const sessionDocId = isResume ? targetUid : uid;

      const sessionData: StudentSession = isResume ? {
        ...existingSessionData!,
        status: 'Aktif',
        lastActivity: Date.now(),
        token: examToken // update token in case it changed
      } : {
        studentName,
        className: matchingExam.targetClass || 'Tidak Diketahui',
        examId: matchingExam.id!,
        subjectId: matchingExam.subjectId,
        token: examToken,
        status: 'Aktif',
        violationsCount: 0,
        lastActivity: Date.now(),
        startTime: Date.now(),
        adminId: matchingExam.adminId
      };

      await setDoc(doc(db, 'student_sessions', sessionDocId), sessionData);

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
          <div className="w-28 h-28 bg-white border border-slate-200 shadow-xl rounded-[1.75rem] p-1 flex items-center justify-center mb-5 overflow-hidden">
            <img 
              src={brandLogo} 
              alt="ANTI CHEATING APP" 
              className="w-full h-full object-contain scale-125" 
              referrerPolicy="no-referrer"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tighter text-slate-900 uppercase">
            ANTI CHEATING APP
          </h1>
          <p className="text-slate-500 mt-2 text-[11px] px-4 font-bold uppercase tracking-wider opacity-60">
            {setting?.schoolSlogan || 'Sistem Ujian Online dengan Integritas Real-time'}
          </p>
        </div>

        {user && !sessionStorage.getItem('skip_auto_redirect') && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl text-center">
                <p className="text-sm font-semibold text-slate-800">Anda sudah login sebagai {isAdmin ? 'Admin' : 'Siswa'}.</p>
                <div className="flex flex-col gap-2 mt-3">
                <button 
                onClick={() => {
                    sessionStorage.setItem('skip_auto_redirect', 'true');
                    navigate(isAdmin ? '/admin' : '/exam');
                }}
                className="text-xs font-bold text-blue-600 hover:underline"
                >
                Lanjut ke Dashboard
                </button>
                <button 
                onClick={() => {
                    sessionStorage.setItem('skip_auto_redirect', 'true');
                }}
                className="text-xs font-bold text-slate-500 hover:underline"
                >
                Tetap di halaman ini
                </button>
                </div>
            </div>
        )}

        {errorMessage && (
          <div className="mb-6 p-3.5 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm justify-center flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}
        
        {successMessage && (
          <div className="mb-6 p-3.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl text-sm justify-center flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-medium">{successMessage}</span>
          </div>
        )}

        <div className="relative">
          <AnimatePresence mode="wait">
            {activeTab === 'student' && (
              <motion.form 
                key="student"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
                onSubmit={handleStudentLogin}
              >
                <div className="mb-2 text-center">
                  <h2 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center justify-center">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse"></span>
                    Portal Login Siswa
                  </h2>
                </div>

                {linkedExam ? (
                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 mb-4 text-center">
                     <p className="text-[11px] font-bold text-blue-500 uppercase tracking-wider mb-1">Anda diundang ke Ujian</p>
                     <h3 className="text-base font-bold text-slate-800 leading-tight">{linkedExam.title}</h3>
                     <p className="text-sm font-medium text-slate-600 mt-1">{linkedSubjectName} • {linkedExam.targetClass || 'Pendaftar Umum'}</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-center">
                     <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informasi</p>
                     <p className="text-sm font-medium text-slate-600">Masukkan Token Ujian dari Guru Anda untuk mengakses ruangan.</p>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Nama Lengkap</label>
                    <input 
                      type="text" 
                      value={studentName}
                      onChange={(e) => setStudentName(e.target.value)}
                      placeholder="Tulis nama lengkap anda"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Token Ujian</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input 
                        type="text" 
                        value={examToken}
                        onChange={(e) => setExamToken(e.target.value.toUpperCase())}
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
                  className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      <span>MULAI UJIAN</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {!hasStudentLink && (
                  <div className="pt-5 border-t border-slate-100 flex justify-center mt-6">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('admin');
                        setErrorMessage('');
                        setSuccessMessage('');
                      }}
                      className="text-[11px] font-extrabold text-slate-400 hover:text-blue-600 hover:underline transition-all uppercase tracking-wider cursor-pointer"
                    >
                      Masuk Sebagai Admin / Proktor
                    </button>
                  </div>
                )}
              </motion.form>
            )}
            
            {activeTab === 'admin' && (
              <motion.form 
                key="admin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleAdminEmailLogin}
                className="space-y-5"
              >
                <div className="mb-2 text-center">
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center justify-center">
                    <span className="w-1.5 h-1.5 bg-slate-800 rounded-full mr-1.5 animate-pulse"></span>
                    Portal Login Admin / Proktor
                  </h2>
                </div>

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
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                         setActiveTab('forgot_password');
                         setErrorMessage('');
                         setSuccessMessage('');
                         setResetEmail(adminEmail);
                      }}
                      className="text-[10px] text-blue-600 font-bold hover:underline"
                    >
                      Lupa password?
                    </button>
                  </div>
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
                  className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white font-bold tracking-wide py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shadow hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Login sebagai Admin</span>}
                </button>

                <div className="pt-5 border-t border-slate-100 flex justify-center mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('student');
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className="text-[11px] font-extrabold text-slate-400 hover:text-slate-600 hover:underline transition-all uppercase tracking-wider cursor-pointer"
                  >
                    ← Kembali ke Login Siswa
                  </button>
                </div>
              </motion.form>
            )}

            {activeTab === 'forgot_password' && (
              <motion.form 
                key="forgot"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleForgotPassword}
                className="space-y-5"
              >
                <div className="mb-2 text-center flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                     <KeyRound className="w-6 h-6 text-blue-500" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">
                    Reset Password
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Masukkan email terdaftar Anda</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Akun</label>
                  <input 
                    type="email" 
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="email@sekolah.com"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-wide py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shadow hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Kirim Tautan Reset</span>}
                </button>

                <div className="pt-5 border-t border-slate-100 flex justify-center mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('admin');
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className="text-[11px] font-extrabold text-slate-400 hover:text-slate-600 hover:underline transition-all uppercase tracking-wider cursor-pointer"
                  >
                    ← Kembali ke halaman Login
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Footer Motivation */}
      {(setting?.motivationText !== undefined ? setting?.motivationText : 'Kejujuran adalah prestasi yang paling berharga. Kerjakan ujian dengan kemampuan dan integritas terbaikmu.') && (
        <div className="mt-12 max-w-lg w-full text-center space-y-4 text-slate-500 z-10 flex flex-col items-center">
          <p className="text-sm leading-relaxed font-serif italic px-6">
            "{setting?.motivationText !== undefined ? setting?.motivationText : 'Kejujuran adalah prestasi yang paling berharga. Kerjakan ujian dengan kemampuan dan integritas terbaikmu.'}"
          </p>
        </div>
      )}
    </div>
  );
}
