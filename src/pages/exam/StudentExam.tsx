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
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const containerRef = useRef<HTMLDivElement>(null);

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

        const exSnap = await getDoc(doc(db, 'exams', sessData.examId));
        if (exSnap.exists()) {
          const exData = exSnap.data() as Exam;
          setExam(exData);
          
          // Calculate initial time left
          const elapsed = Math.floor((Date.now() - sessData.startTime) / 1000);
          const totalSecs = exData.duration * 60;
          setTimeLeft(Math.max(0, totalSecs - elapsed));

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
    const unsub = onSnapshot(doc(db, 'student_sessions', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const dat = { id: docSnap.id, ...docSnap.data() } as StudentSession;
        setSession(dat);
        if (dat.status === 'Didiskualifikasi') {
          alert('Ujian Anda dihentikan paksa oleh Admin karena pelanggaran.');
        }
      }
    });
    return () => unsub();
  }, [user]);

  // Anti-Cheat: Listeners
  const recordViolation = async (type: string, message: string) => {
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi') return;
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
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi') return;

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
  }, [session, settings]);

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
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || !isFullscreen) return;

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
  }, [session?.status, isFullscreen]);

  const handleAnswer = async (qId: string, ans: string) => {
    const newAnswers = { ...answers, [qId]: ans };
    setAnswers(newAnswers);
    // Auto save answers periodically? Let's just save immediately for safety
    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), { answers: newAnswers });
    } catch(e) { console.error("Gagal simpan jawaban sementara"); }
  };

  const submitExam = async () => {
    if (!session || !exam) return;
    
    const totalQuestions = questions.length;
    if (totalQuestions === 0) {
      alert('Tidak ada soal dalam ujian ini. Silakan hubungi pengawas.');
      return;
    }
    
    // Auto calculate score
    let correct = 0;
    let wrong = 0;
    
    questions.forEach(q => {
      const studentAns = answers[q.id!];
      if (studentAns) {
        if (studentAns === q.correctAnswer) correct++;
        else wrong++;
      }
    });

    const score = (correct / totalQuestions) * 100;

    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), {
        status: 'Selesai',
        endTime: Date.now(),
        score,
        correctCount: correct,
        wrongCount: wrong,
        answers
      });
      // Exit fullscreen safely
      if (document.fullscreenElement) document.exitFullscreen();
    } catch (e) {
      console.error(e);
      alert('Gagal mensubmit ujian. Tolong hubungi pengawas.');
    }
  };

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

  if (!isFullscreen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <Maximize className="w-16 h-16 text-blue-400 mb-6" />
        <h1 className="text-3xl font-bold mb-4">Mulai Ujian</h1>
        <p className="max-w-md text-slate-300 mb-8 leading-relaxed">
          Ujian ini menggunakan sistem keamanan anti-contek Anti Cheating App. Layar akan diubah menjadi fullscreen. 
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

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-2 shrink-0 flex items-center justify-between sticky top-0 z-40">
        <div className="flex flex-col justify-center">
          <h1 className="font-bold text-slate-800 text-sm">{exam.title}</h1>
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{session.studentName} • Kelas {session.className}</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center px-2.5 py-1 rounded border bg-slate-50 border-slate-200 text-slate-700 shadow-xs">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mr-2">Jam:</span>
            <span className="font-mono stroke-2 font-bold text-xs tracking-wider">
              {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <div className="flex items-center text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border border-red-100">
            <ShieldAlert className="w-3.5 h-3.5 mr-1" />
            <span>Pelanggaran: {session.violationsCount}</span>
          </div>
          <div className={`flex items-center px-3 py-1 rounded border ${timeLeft < 300 ? 'bg-red-50 border-red-200 text-red-700 animate-pulse' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            <Clock className="w-4 h-4 mr-1.5" />
            <span className="font-mono stroke-2 font-bold text-sm tracking-widest">{formatTime(timeLeft)}</span>
          </div>
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
               </div>
            ) : (
               <div className="flex-1 flex items-center justify-center text-slate-500 text-xs font-bold uppercase">
                 Tidak ada soal ditemukan.
               </div>
            )}
            
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
               <button 
                 disabled={currentQuestionIndex === 0}
                 onClick={() => setCurrentQuestionIndex(prev => prev - 1)}
                 className="px-4 py-2 rounded border border-slate-300 text-slate-600 text-[11px] font-bold uppercase tracking-wider hover:bg-slate-50 disabled:opacity-50 transition-colors"
               >
                 Soal Sebelumnya
               </button>
               {currentQuestionIndex < questions.length - 1 ? (
                 <button 
                  onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
                  className="px-4 py-2 rounded border border-blue-600 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-blue-700 transition-colors"
                 >
                   Soal Selanjutnya
                 </button>
               ) : (
                  <button 
                  onClick={() => { if(confirm('Yakin ingin menyelesaikan ujian dan mengirim jawaban?')) submitExam(); }}
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
                   onClick={() => setCurrentQuestionIndex(idx)}
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
        </div>
      </div>
    </div>
  );
}
