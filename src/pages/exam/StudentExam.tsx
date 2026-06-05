import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, handleFirestoreError, OperationType, auth } from '../../lib/firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, onSnapshot } from 'firebase/firestore';
import { StudentSession, Exam, Question, Setting, Violation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, Maximize, Clock, Save, AlertTriangle, LogOut, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function StudentExam() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<StudentSession | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [settings, setSettings] = useState<Setting | null>(null);
  const [loadError, setLoadError] = useState('');
  const [subjectName, setSubjectName] = useState('');
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [acknowledgedWarningTime, setAcknowledgedWarningTime] = useState<number>(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmittingOrFinished, setIsSubmittingOrFinished] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Submit Exam Function (Declared Early for full accessibility and auto-timeouts)
  const submitExam = useCallback(async () => {
    if (!session || !exam || isSubmittingOrFinished) return;
    
    // Set submitting flag immediately to prevent duplicate runs and ignore external alerts
    setIsSubmittingOrFinished(true);
    
    const totalQuestions = questions.length;
    if (totalQuestions === 0) {
      alert('Tidak ada soal dalam ujian ini. Silakan hubungi pengawas.');
      setIsSubmittingOrFinished(false);
      return;
    }

    // Calculate weight-based score
    let pointsEarned = 0;
    let totalWeight = 0;
    let correct = 0;
    let wrong = 0;
    
    questions.forEach(q => {
      const isEssay = q.type === 'essay';
      const weight = q.weight || 10;
      totalWeight += weight;
      
      const studentAns = answers[q.id!];
      if (!isEssay) {
        if (studentAns === q.correctAnswer) {
          correct++;
          pointsEarned += weight;
        } else {
          wrong++;
        }
      }
    });

    const score = totalWeight > 0 ? (pointsEarned / totalWeight) * 100 : 0;

    // Set local session state status to Complete instantly for fast UI feedback
    setSession(prev => prev ? { ...prev, status: 'Selesai' } : null);

    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), {
        status: 'Selesai',
        endTime: Date.now(),
        score,
        correctCount: correct,
        wrongCount: wrong,
        answers
      });
      // Safety: Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (e) {
      console.error("Gagal submit ujian:", e);
      setIsSubmittingOrFinished(false);
      alert('Gagal mengumpulkan ujian. Silakan cek koneksi internet Anda dan coba lagi.');
    }
  }, [session, exam, questions, answers, user, isSubmittingOrFinished]);

  // Real-time Clock Timer
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Load Initial Data
  useEffect(() => {
    if (!user) return;
    async function loadData() {
      try {
        const setSnap = await getDoc(doc(db, 'settings', 'school'));
        if (setSnap.exists()) setSettings(setSnap.data() as Setting);

        const sessSnap = await getDoc(doc(db, 'student_sessions', user!.uid));
        if (!sessSnap.exists()) {
          setLoadError("Sesi ujian tidak valid atau Anda bukan siswa yang terdaftar. Mohon logout lalu login sebagai Admin.");
          return;
        }
        const sessData = { id: sessSnap.id, ...sessSnap.data() } as StudentSession;
        setSession(sessData);
        setAnswers(sessData.answers || {});
        if (sessData.lastQuestionIndex !== undefined) {
          setCurrentQuestionIndex(sessData.lastQuestionIndex);
        }

        const exSnap = await getDoc(doc(db, 'exams', sessData.examId));
        if (exSnap.exists()) {
          const exData = exSnap.data() as Exam;
          setExam(exData);

          try {
            const subSnap = await getDoc(doc(db, 'subjects', exData.subjectId));
            if (subSnap.exists()) {
              setSubjectName(subSnap.data().name);
            } else {
              setSubjectName('Mata Pelajaran Tidak Diketahui');
            }
          } catch (e) {
            console.error("Gagal load subject name", e);
            setSubjectName('Mata Pelajaran Tidak Diketahui');
          }
          
          // Calculate initial time left
          const elapsed = Math.floor((Date.now() - sessData.startTime) / 1000);
          const totalSecs = exData.duration * 60;
          const calculatedTimeLeft = totalSecs - elapsed;

          // Fetch questions
          let qQuery;
          if (exData.packetName) {
            qQuery = query(collection(db, 'questions'), 
              where('subjectId', '==', sessData.subjectId),
              where('packetName', '==', exData.packetName)
            );
          } else {
            qQuery = query(collection(db, 'questions'), where('subjectId', '==', sessData.subjectId));
          }
          
          const qSnap = await getDocs(qQuery);
          const qs = qSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Question)).sort((a,b) => a.number - b.number);
          setQuestions(qs);

          if (calculatedTimeLeft <= 0) {
            setTimeLeft(0);
            setTimeout(() => {
              submitExam();
            }, 500);
          } else {
            setTimeLeft(calculatedTimeLeft);
          }
        }

      } catch (err) {
        console.error("Gagal load data", err);
        setLoadError("Terjadi kesalahan saat memuat ujian. Pastikan koneksi internet stabil.");
      }
    }
    loadData();
  }, [user]);

  // Listen to remote changes on session (for admin warnings/kicks)
  useEffect(() => {
    if (!user) return;
    let initialized = false;
    const unsub = onSnapshot(doc(db, 'student_sessions', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const dat = { id: docSnap.id, ...docSnap.data() } as StudentSession;
        setSession(dat);
        
        // Match user's warning timestamp upon first mount to prevent showing legacy warnings
        if (!initialized) {
          if (dat.adminWarningTime) {
            setAcknowledgedWarningTime(dat.adminWarningTime);
          }
          initialized = true;
        }

        if (dat.status === 'Didiskualifikasi') {
          alert('Ujian Anda dihentikan paksa oleh Admin karena pelanggaran.');
        }
      }
    });
    return () => unsub();
  }, [user]);

  // Listen to exam duration changes
  useEffect(() => {
    if (!session?.examId || !session?.startTime) return;
    const unsub = onSnapshot(doc(db, 'exams', session.examId), (docSnap) => {
      if (docSnap.exists()) {
        const exData = docSnap.data() as Exam;
        setExam(exData);
        // Recalculate time left automatically based on the new duration
        const elapsed = Math.floor((Date.now() - session.startTime!) / 1000);
        const totalSecs = exData.duration * 60;
        const calculatedTimeLeft = totalSecs - elapsed;
        if (calculatedTimeLeft <= 0) {
          setTimeLeft(0);
          setTimeout(() => {
            submitExam();
          }, 500);
        } else {
          setTimeLeft(calculatedTimeLeft);
        }
      }
    });
    return () => unsub();
  }, [session?.examId, session?.startTime, submitExam]);

  // Anti-Cheat: Listeners
  const isUnloading = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnloading.current = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleBeforeUnload); // Fallback
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleBeforeUnload);
    };
  }, []);

  const recordViolation = async (type: string, message: string) => {
    if (isUnloading.current) return;
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || isSubmittingOrFinished) return;
    setWarningMessage(message);
    
    setTimeout(() => setWarningMessage(''), 5000);

    const newCount = (session.violationsCount || 0) + 1;
    const max = settings?.maxViolations || 3;
    const willDisqualify = max > 0 && newCount >= max;

    try {
      await addDoc(collection(db, 'violations'), {
        sessionId: session.id || user!.uid,
        studentName: session.studentName || 'Siswa',
        subjectId: session.subjectId || '',
        type,
        status: willDisqualify ? 'Diskualifikasi otomatis' : 'Tercatat',
        timestamp: Date.now()
      });

      if (willDisqualify) {
         await updateDoc(doc(db, 'student_sessions', user!.uid), {
           status: 'Didiskualifikasi',
           violationsCount: newCount,
           endTime: Date.now()
         });
      } else {
         await updateDoc(doc(db, 'student_sessions', user!.uid), {
           status: 'Melanggar',
           violationsCount: newCount,
           lastActivity: Date.now()
         });
         
         // reset status briefly
         setTimeout(() => {
            updateDoc(doc(db, 'student_sessions', user!.uid), { status: 'Aktif' }).catch(()=>{});
         }, 5000);
      }
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || isSubmittingOrFinished) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordViolation('Pindah Tab Browser', 'Terdeteksi pindah tab! Tindakan ini dilarang.');
      }
    };

    const handleBlur = () => {
      recordViolation('Membuka aplikasi lain', 'Fokus hilang dari ujian! Jangan buka aplikasi lain.');
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        recordViolation('Keluar Fullscreen', 'Keluar dari layar penuh! Ujian harus dikerjakan secara fullscreen.');
      } else {
        setIsFullscreen(true);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent common shortcuts: Ctrl+C, Ctrl+V, F12 (DevTools), PrintScreen, Atl+Tab handled by blur usually but just in case
      if (
        e.key === 'Alt' ||
        e.key === 'Tab' ||
        e.key === 'Meta' ||
        e.key === 'Escape' ||
        e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && e.key === 'I') || 
        (e.ctrlKey && e.shiftKey && e.key === 'J') ||
        (e.ctrlKey && e.key === 'U') ||
        (e.ctrlKey && e.key === 'c') ||
        (e.ctrlKey && e.key === 'v') ||
        e.key === 'PrintScreen'
      ) {
        e.preventDefault();
        let type = 'Tombol Shortcut Terlarang';
        if (e.key === 'Alt') type = 'Menekan Tombol Alt';
        if (e.key === 'Tab') type = 'Menekan Tombol Tab';
        if (e.key === 'Meta') type = 'Membuka Start Menu / Windows';
        if (e.key === 'Escape') type = 'Keluar dari Layar Penuh';
        if (e.key === 'PrintScreen') type = 'Screenshot Layar';
        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) type = 'Membuka Developer Tools';

        recordViolation(type, `Aksi terlarang terdeteksi: ${type}`);
      }
    };

    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      recordViolation('Menyalin / Menempel', 'Menyalin atau menempel teks sangat dilarang.');
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('contextmenu', (e) => e.preventDefault()); // no right click

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('contextmenu', (e) => e.preventDefault());
    };
  }, [session, settings, isSubmittingOrFinished]);

  // Request Fullscreen
  const requestFullscreen = () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    }
  };

  // Timer & Heartbeat
  useEffect(() => {
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || isSubmittingOrFinished) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          submitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const heartbeat = setInterval(() => {
      updateDoc(doc(db, 'student_sessions', user!.uid), {
        lastActivity: Date.now()
      }).catch(()=>{});
    }, 10000); // every 10s

    return () => { clearInterval(timer); clearInterval(heartbeat); };
  }, [session?.status, isFullscreen, isSubmittingOrFinished]);

  // Handle question change and persistence
  const changeQuestion = async (newIndex: number) => {
    setCurrentQuestionIndex(newIndex);
    if (user) {
      try {
        await updateDoc(doc(db, 'student_sessions', user.uid), {
          lastQuestionIndex: newIndex,
          lastActivity: Date.now()
        });
      } catch (e) {
        console.error("Gagal simpan progress soal", e);
      }
    }
  };

  const handleAnswer = async (qId: string, ans: string) => {
    const newAnswers = { ...answers, [qId]: ans };
    setAnswers(newAnswers);
    // Auto save answers periodically? Let's just save immediately for safety
    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), { answers: newAnswers });
    } catch(e) { console.error("Gagal simpan jawaban sementara"); }
  };

  // submitExam is declared above as a useCallback hook

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border">
          <div className="w-20 h-20 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-6">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Akses Ditolak</h2>
          <p className="text-slate-500 mb-6 text-sm">{loadError}</p>
          <button onClick={async () => { await logout(); navigate('/'); }} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2 rounded-lg font-medium transition-colors w-full">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  if (!session || !exam) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-900"><Loader2 className="w-8 h-8 text-white animate-spin" /></div>;
  }

  if (session.status === 'Selesai' || session.status === 'Didiskualifikasi') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border top-4">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${session.status === 'Didiskualifikasi' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
            {session.status === 'Didiskualifikasi' ? <ShieldAlert className="w-10 h-10" /> : <Save className="w-10 h-10" />}
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Ujian Selesai</h2>
          <p className="text-slate-500 mb-6">
            {session.status === 'Didiskualifikasi' ? 'Ujian Anda telah dihentikan karena pelanggaran tata tertib.' : 'Jawaban Anda telah berhasil disimpan di sistem.'}
          </p>
          <button onClick={async () => { await logout(); navigate('/'); }} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors w-full">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  if (!isFullscreen && session.status !== 'Selesai' && session.status !== 'Didiskualifikasi') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <Maximize className="w-16 h-16 text-blue-400 mb-6" />
        <h1 className="text-3xl font-bold mb-4">Mulai Ujian</h1>
        <p className="max-w-md text-slate-300 mb-8 leading-relaxed">
          Ujian ini menggunakan sistem keamanan Anti Cheating App. Layar akan diubah menjadi fullscreen. 
          Anda dilarang berpindah tab, membuka aplikasi lain, keluar layar penuh, atau melakukan kombinasi tombol terlarang.
        </p>
        <button 
          onClick={requestFullscreen}
          className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-medium text-lg shadow-lg hover:shadow-xl transition-all"
        >
          Masuk ke Mode Layar Penuh
        </button>
      </div>
    );
  }

  const currentQ = questions[currentQuestionIndex];

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-50 flex flex-col select-none">

      {/* Admin Warning Modal Overlay */}
      {session && session.adminWarningTime && session.adminWarningTime > acknowledgedWarningTime && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] max-w-md w-full border border-red-100 p-6 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4 shadow-sm animate-bounce">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-red-600 uppercase tracking-widest mb-1 font-sans">
              Teguran Kedisiplinan
            </h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-4">
              Pesan Dari Pengawas Ujian
            </p>
            <div className="w-full bg-red-50/50 rounded-xl p-4 border border-red-100/50 mb-6 text-left">
              <p className="text-xs text-red-700 leading-relaxed font-semibold">
                {session.adminWarningMessage || "Mohon penuhi instruksi keselamatan ujian agar pengerjaan tetap aman!"}
              </p>
            </div>
            <button 
              onClick={() => {
                setAcknowledgedWarningTime(session.adminWarningTime!);
              }}
              className="w-full py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-sm tracking-wider uppercase rounded-xl transition-all shadow-md active:scale-95 cursor-pointer font-sans"
            >
              Oke, Saya Mengerti
            </button>
          </div>
        </div>
      )}
      
      {/* Alert Overlay */}
      <AnimatePresence>
        {warningMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center space-x-3 w-max max-w-[90vw]"
          >
            <AlertTriangle className="w-6 h-6 animate-pulse" />
            <span className="font-bold">{warningMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.4)] max-w-md w-full border border-slate-100 p-6 flex flex-col items-center animate-in scale-in duration-200">
            <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-4 shadow-sm">
              <Save className="w-8 h-8 animate-pulse" />
            </div>
            
            <h3 className="text-lg font-extrabold text-slate-800 uppercase tracking-wider mb-2 font-sans">
              {Object.keys(answers).length < questions.length ? 'Peringatan: Soal Belum Selesai' : 'Selesaikan Ujian?'}
            </h3>
            
            <p className="text-xs text-slate-500 mb-6 text-center leading-relaxed font-medium">
              {Object.keys(answers).length < questions.length 
                ? `Terdapat ${questions.length - Object.keys(answers).length} soal yang belum Anda jawab. Apakah Anda yakin ingin mengakhiri sesi ujian ini sekarang?`
                : 'Apakah Anda yakin ingin mengakhiri sesi ujian ini? Semua jawaban Anda telah tersimpan secara otomatis di server sistem.'}
              {" "}Anda tidak dapat mengubah jawaban setelah menyelesaikan ujian.
            </p>

            {/* Stats Summary */}
            <div className="w-full bg-slate-50 rounded-xl p-4 border border-slate-200/60 mb-6 font-sans">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Total Soal</p>
                  <p className="text-lg font-black text-slate-700">{questions.length}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Sudah Dijawab</p>
                  <p className="text-lg font-black text-green-600">{Object.keys(answers).length}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 w-full">
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer font-sans"
              >
                Kembali
              </button>
              <button 
                onClick={async () => {
                  setShowConfirmModal(false);
                  await submitExam();
                }}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 cursor-pointer font-sans"
              >
                Selesai & Kirim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-2 shrink-0 flex items-center justify-between sticky top-0 z-40">
        <div className="flex flex-col justify-center">
          <h1 className="font-bold text-slate-800 text-sm">{exam.title}</h1>
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">
            {session.studentName} • Kelas: {session.className} • {subjectName}
          </p>
        </div>
        <div className="flex items-center space-x-3 text-slate-700">
          <div className="font-mono text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full font-medium">
            {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="flex items-center text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border border-red-100">
            <ShieldAlert className="w-3.5 h-3.5 mr-1" />
            <span>Pelanggaran: {session.violationsCount}</span>
          </div>
          <div className={`flex items-center px-3 py-1 rounded border ${timeLeft < 300 ? 'bg-red-50 border-red-200 text-red-700 animate-pulse' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            <Clock className="w-4 h-4 mr-1.5" />
            <span className="font-mono stroke-2 font-bold text-sm tracking-widest">{formatTime(timeLeft)}</span>
          </div>
          <button
            onClick={() => setShowConfirmModal(true)}
            className="flex items-center bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-1.5 shadow-sm transition-all duration-150 cursor-pointer"
            title="Kumpulkan ujian sekarang"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            <span>Kumpulkan</span>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col min-h-full">
            {currentQ ? (
               <div className="flex-1 flex flex-col">
                 <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <span className="bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Soal No. {currentQ.number}</span>
                    <span className="text-slate-400 text-[10px] font-bold uppercase">Bobot: {currentQ.weight}</span>
                 </div>
                 
                 <div className="prose max-w-none text-slate-800 text-sm font-medium mb-6 leading-relaxed" dangerouslySetInnerHTML={{ __html: currentQ.question }} />

                 {currentQ.type === 'essay' ? (
                   <div className="mt-4 flex flex-col flex-1">
                     <div className="flex items-center justify-between mb-2">
                       <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                         <span className="w-1.5 h-1.5 bg-purple-500 rounded-full mr-1.5 animate-pulse"></span>
                         Jawaban Uraian Anda:
                       </label>
                       <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 rounded px-1.5 py-0.5 font-bold uppercase">
                         Sistem Essay
                       </span>
                     </div>
                     <textarea
                       rows={8}
                       value={answers[currentQ.id!] || ''}
                       onChange={(e) => handleAnswer(currentQ.id!, e.target.value)}
                       placeholder="Ketikkan jawaban lengkap Anda secara detail di sini..."
                       className="w-full p-4 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-y font-medium text-slate-800 leading-relaxed shadow-xs transition-all animate-in fade-in"
                     />
                     <p className="text-[10px] text-slate-400 mt-1.5 italic font-medium">Jawaban Anda disimpan secara otomatis saat Anda mengetik atau berpindah soal.</p>
                   </div>
                 ) : (
                   <div className="space-y-2 mt-auto">
                     {['A', 'B', 'C', 'D', 'E'].map(opt => {
                       const key = `option${opt}` as keyof Question;
                       const val = currentQ[key];
                       if (!val) return null;
                       const isSelected = answers[currentQ.id!] === opt;
                       
                       return (
                         <label 
                           key={opt}
                           className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'}`}
                         >
                           <input 
                             type="radio" 
                             className="sr-only" 
                             checked={isSelected}
                             onChange={() => handleAnswer(currentQ.id!, opt)}
                           />
                           <span className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[11px] mr-3 ${isSelected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 text-slate-500'}`}>
                             {opt}
                           </span>
                           <div className="flex-1 pt-0 text-sm text-slate-700">{val as string}</div>
                         </label>
                       );
                     })}
                   </div>
                 )}
               </div>
            ) : (
               <div className="flex-1 flex items-center justify-center text-slate-500 text-xs font-bold uppercase">
                 Tidak ada soal ditemukan.
               </div>
            )}
            
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
               <button 
                 disabled={currentQuestionIndex === 0}
                 onClick={() => changeQuestion(currentQuestionIndex - 1)}
                 className="px-4 py-2 rounded border border-slate-300 text-slate-600 text-[11px] font-bold uppercase tracking-wider hover:bg-slate-50 disabled:opacity-50 transition-colors"
               >
                 Soal Sebelumnya
               </button>
               {currentQuestionIndex < questions.length - 1 ? (
                 <button 
                  onClick={() => changeQuestion(currentQuestionIndex + 1)}
                  className="px-4 py-2 rounded border border-blue-600 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-blue-700 transition-colors"
                 >
                   Soal Selanjutnya
                 </button>
               ) : (
                  <button 
                  onClick={() => { setShowConfirmModal(true) }}
                  className="px-4 py-2 rounded bg-green-600 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-green-700 transition-colors shadow-sm"
                 >
                   Selesai Ujian
                 </button>
               )}
            </div>
          </div>
        </div>

        {/* Sidebar Nav */}
        <div className="w-64 bg-white border-l border-slate-200 overflow-y-auto shrink-0 flex flex-col hidden lg:flex">
           <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col space-y-1">
             <h3 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Navigasi Soal</h3>
             <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1 relative">
                <div className="absolute top-0 left-0 bottom-0 bg-blue-500 transition-all" style={{width: `${questions.length ? (Object.keys(answers).length / questions.length) * 100 : 0}%`}} />
             </div>
             <span className="text-[10px] font-bold text-slate-500 text-right">{Object.keys(answers).length} / {questions.length} Dijawab</span>
           </div>
           <div className="p-3 grid grid-cols-5 gap-1.5 auto-rows-max">
             {questions.map((q, idx) => {
               const isAnswered = !!answers[q.id!];
               const isCurrent = currentQuestionIndex === idx;
               
               return (
                 <button
                   key={q.id}
                   onClick={() => changeQuestion(idx)}
                   className={`h-8 rounded flex items-center justify-center font-bold text-[11px] transition-colors ${
                     isCurrent 
                       ? 'ring-1 ring-offset-1 ring-blue-500 bg-blue-600 text-white shadow-sm' 
                       : isAnswered 
                         ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                         : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                   }`}
                 >
                   {q.number}
                 </button>
               )
             })}
           </div>
           <div className="hidden mt-auto p-3 border-t border-slate-100 bg-slate-50 flex flex-col gap-1.5 text-center">
             <button
               onClick={() => setShowConfirmModal(true)}
               className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
             >
               <Save size={14} />
               Kumpulkan Ujian
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}
