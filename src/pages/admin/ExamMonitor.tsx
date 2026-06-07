import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, doc, updateDoc, onSnapshot, getDocs, addDoc, deleteDoc, getDoc, where } from 'firebase/firestore';
import { StudentSession, Violation, Exam, Subject, Class } from '../../types';
import { Loader2, AlertTriangle, Eye, ShieldAlert, MonitorOff, Activity, BadgeAlert, X, Trash2, LayoutGrid, Users, Search, ChevronRight, Play, CheckCircle2, Clock3, Ban, Unlock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

export default function ExamMonitor() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [exams, setExams] = useState<Record<string, Exam>>({});
  const [classesData, setClassesData] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Record<string, Subject>>({});
  const [loading, setLoading] = useState(true);
  const [maxViolations, setMaxViolations] = useState<number>(3);

  // Filters
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterExam, setFilterExam] = useState<string>('');
  const [showAllMode, setShowAllMode] = useState(false);
  const [examSearch, setExamSearch] = useState<string>('');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('');

  // Detail Modal
  const [selectedSession, setSelectedSession] = useState<StudentSession | null>(null);
  const [sessionViolations, setSessionViolations] = useState<Violation[]>([]);

  // Toast Notification state
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  // Custom Confirmation Dialog Modal state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'warning' | 'end_exam' | 'delete' | 'restore';
    candidateId?: string;
    candidateName: string;
    session?: StudentSession;
  }>({
    isOpen: false,
    type: 'warning',
    candidateName: ''
  });

  // A global timer ticker to update remaining time on display dynamically every second
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [durationModal, setDurationModal] = useState<{
    isOpen: boolean;
    mode: 'individual' | 'mass';
    studentSession?: StudentSession;
    className?: string;
    newDuration: number;
  }>({
    isOpen: false,
    mode: 'individual',
    newDuration: 90
  });

  const handleSaveDuration = async () => {
    const { mode, studentSession, className, newDuration } = durationModal;
    setDurationModal(prev => ({ ...prev, isOpen: false }));

    if (mode === 'individual' && studentSession) {
      try {
        const elapsedMin = (Date.now() - studentSession.startTime) / 60000;
        const targetDuration = newDuration + elapsedMin;
        await updateDoc(doc(db, 'student_sessions', studentSession.id!), {
          duration: targetDuration
        });
        showToast(`Sisa durasi ujian ${studentSession.studentName} diubah menjadi ${newDuration} menit`);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'student_sessions');
      }
    } else if (mode === 'mass' && className) {
      try {
        // Find all active student sessions for this target class and update their durations to the exact same remaining time
        const activeSessionsInClass = sessions.filter(
          s => s.className === className && s.status !== 'Selesai' && s.status !== 'Didiskualifikasi'
        );
        if (activeSessionsInClass.length === 0) {
          showToast(`Tidak ada peserta aktif di kelas ${className}`);
          return;
        }
        
        let successCount = 0;
        await Promise.all(activeSessionsInClass.map(async (s) => {
          try {
            const elapsedMin = (Date.now() - s.startTime) / 60000;
            const targetDuration = newDuration + elapsedMin;
            await updateDoc(doc(db, 'student_sessions', s.id!), {
              duration: targetDuration
            });
            successCount++;
          } catch(e) {
            console.error(`Gagal update durasi ${s.studentName}`, e);
          }
        }));
        
        showToast(`Berhasil menyamakan sisa durasi ${successCount} siswa di kelas ${className} menjadi ${newDuration} menit`);
      } catch (err) {
        console.error(err);
        showToast('Ada kesalahan saat mengubah durasi massal');
      }
    }
  };

  useEffect(() => {
    // Fetch static references first
    const fetchRefs = async () => {
      if (!user) return;
      try {
        const [exSnap, subSnap, setSnap, clsSnap] = await Promise.all([
          getDocs(query(collection(db, 'exams'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'subjects'), where('adminId', '==', user.uid))),
          getDoc(doc(db, 'settings', user.uid)),
          getDocs(query(collection(db, 'classes'), where('adminId', '==', user.uid)))
        ]);
        
        const exMap: Record<string, Exam> = {};
        exSnap.forEach(d => {
          exMap[d.id] = { id: d.id, ...d.data() } as Exam;
        });
        setExams(exMap);

        const subMap: Record<string, Subject> = {};
        subSnap.forEach(d => {
          subMap[d.id] = { id: d.id, ...d.data() } as Subject;
        });
        setSubjects(subMap);

        const clsList = clsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Class));
        clsList.sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
        setClassesData(clsList);

        if (setSnap && setSnap.exists()) {
          const sData = setSnap.data();
          if (typeof sData.maxViolations === 'number') {
            setMaxViolations(sData.maxViolations);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    fetchRefs().then(() => {
      if (!user) return;
      
      // Subscribe to active sessions
      let q = query(collection(db, 'student_sessions'), where('adminId', '==', user.uid));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
        // Sort active first, then newest
        data.sort((a, b) => {
          if (a.status === 'Aktif' && b.status !== 'Aktif') return -1;
          if (b.status === 'Aktif' && a.status !== 'Aktif') return 1;
          return b.startTime - a.startTime;
        });
        setSessions(data);
        setLoading(false);
        
        // Update selected session if open
        if (selectedSession && Array.isArray(data)) {
          const updated = data.find(s => s.id === selectedSession.id);
          if (updated) setSelectedSession(updated);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'student_sessions');
      });
      return () => { if (unsubscribe) unsubscribe(); };
    });
  }, [user]);

  const filteredSessions = sessions
    .filter(s => {
      if (showAllMode) return true;
      if (filterClass && s.className !== filterClass) return false;
      if (filterExam && s.examId !== filterExam) return false;
      if (!filterClass && !filterExam) return false;
      return true;
    })
    .reduce((acc: StudentSession[], current) => {
      // Deduplicate by Name + ExamID to handle students logging in again after clearing cache/restoration
      const key = `${current.studentName}_${current.examId}`;
      const existingIdx = acc.findIndex(s => `${s.studentName}_${s.examId}` === key);
      
      if (existingIdx === -1) {
        acc.push(current);
      } else {
        const existing = acc[existingIdx];
        // Give priority to status and then activity time
        const getPriority = (status: string) => {
          if (status === 'Aktif') return 3;
          if (status === 'Selesai') return 2;
          return 1;
        };
        
        if (getPriority(current.status) > getPriority(existing.status)) {
          acc[existingIdx] = current;
        } else if (getPriority(current.status) === getPriority(existing.status) && (current.lastActivity || 0) > (existing.lastActivity || 0)) {
          acc[existingIdx] = current;
        }
      }
      return acc;
    }, []);

  const openMonitor = async (session: StudentSession) => {
    setSelectedSession(session);
    // Fetch violations for this session
    try {
      const vSnap = await getDocs(query(collection(db, 'violations')));
      const vols = vSnap.docs
        .map(d => d.data() as Violation)
        .filter(v => v.sessionId === session.id)
        .sort((a, b) => b.timestamp - a.timestamp);
      setSessionViolations(vols);
    } catch (e) { console.error(e); }
  };

  const triggerWarning = (session: StudentSession) => {
    setConfirmDialog({
      isOpen: true,
      type: 'warning',
      candidateName: session.studentName,
      session
    });
  };

  const triggerEndExam = (session: StudentSession) => {
    setConfirmDialog({
      isOpen: true,
      type: 'end_exam',
      candidateName: session.studentName,
      session
    });
  };

  const triggerDelete = (id: string, name: string) => {
    setConfirmDialog({
      isOpen: true,
      type: 'delete',
      candidateId: id,
      candidateName: name
    });
  };

  const triggerRestore = (session: StudentSession) => {
    setConfirmDialog({
      isOpen: true,
      type: 'restore',
      candidateName: session.studentName,
      session
    });
  };

  const executeConfirmedAction = async () => {
    const { type, session, candidateId } = confirmDialog;
    setConfirmDialog(prev => ({ ...prev, isOpen: false }));

    if (type === 'warning' && session) {
      const msg = "Perhatian! Sistem mendeteksi aktivitas yang tidak sesuai aturan ujian. Mohon tetap fokus dan mengerjakan ujian dengan jujur. Pelanggaran berikutnya dapat menyebabkan ujian dihentikan.";
      try {
        const currentViolations = session.violationsCount || 0;
        const newCount = currentViolations + 1;
        const examMax = typeof exams[session.examId]?.maxViolations === 'number' ? exams[session.examId].maxViolations : maxViolations;
        const willDisqualify = examMax > 0 && newCount >= examMax;

        // 1. Update the student_session document
        await updateDoc(doc(db, 'student_sessions', session.id!), {
          violationsCount: newCount,
          status: willDisqualify ? 'Didiskualifikasi' : 'Melanggar',
          wasDisqualified: willDisqualify ? true : (session.wasDisqualified || false),
          adminWarningMessage: msg,
          adminWarningTime: Date.now(),
          lastActivity: Date.now(),
          endTime: willDisqualify ? Date.now() : null
        });

        // 2. Add the violation log
        await addDoc(collection(db, 'violations'), {
          sessionId: session.id,
          studentName: session.studentName,
          subjectId: session.subjectId,
          type: 'Peringatan Admin',
          status: willDisqualify ? 'Diskualifikasi otomatis (Peringatan Maksimal)' : msg,
          timestamp: Date.now()
        });

        showToast(willDisqualify ? 'Peringatan terkirim (Disertai Diskualifikasi Maksimal)' : 'Peringatan terkirim');
        if (selectedSession?.id === session.id) {
          // Re-fetch violations to keep the detail modal updated
          openMonitor({
            ...session,
            violationsCount: newCount,
            status: willDisqualify ? 'Didiskualifikasi' : 'Melanggar',
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'student_sessions');
      }
    } else if (type === 'end_exam' && session) {
      try {
        await updateDoc(doc(db, 'student_sessions', session.id!), {
          status: 'Didiskualifikasi',
          wasDisqualified: true,
          adminWarningMessage: 'Ujian dihentikan paksa oleh pengawas.',
          adminWarningTime: Date.now(),
          endTime: Date.now()
        });
        
        // Also log it as a violation
        await addDoc(collection(db, 'violations'), {
          sessionId: session.id,
          studentName: session.studentName,
          subjectId: session.subjectId,
          type: 'Diskualifikasi Paksa',
          status: 'Dihentikan langsung oleh pengawas.',
          timestamp: Date.now()
        });
        
        setSelectedSession(null);
        showToast('Ujian telah dihentikan paksa');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'student_sessions');
      }
    } else if (type === 'restore' && session) {
      try {
        await updateDoc(doc(db, 'student_sessions', session.id!), {
          status: 'Aktif',
          violationsCount: 0, // Reset violations on restore
          endTime: null,
          wasDisqualified: true, // Keep true for history
          lastActivity: 0 // Reset activity to force "Waiting for Login" status UI
        });
        showToast('Murid diizinkan melanjutkan ujian');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'student_sessions');
      }
    } else if (type === 'delete' && candidateId) {
      try {
        await deleteDoc(doc(db, 'student_sessions', candidateId));
        showToast('Sesi ujian berhasil dihapus');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'student_sessions');
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Aktif': return <span className="flex items-center gap-1.5 text-xs text-slate-700"><span className="w-2 h-2 rounded-full bg-green-500 shadow-sm"></span> Aktif</span>;
      case 'Tidak Fokus': return <span className="flex items-center gap-1.5 text-xs text-orange-500"><span className="w-2 h-2 rounded-full bg-orange-400"></span> Tidak Fokus</span>;
      case 'Melanggar': return <span className="flex items-center gap-1.5 text-xs text-red-600 font-bold"><span className="w-2 h-2 rounded-full bg-red-600"></span> MELANGGAR</span>;
      case 'Selesai': return <span className="flex items-center gap-1.5 text-xs text-blue-600"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Selesai</span>;
      case 'Didiskualifikasi': return <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Diskualifikasi</span>;
      default: return <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-300"></span> {status}</span>;
    }
  };

  const getRemainingTimeDisplay = (s: StudentSession) => {
    if (s.status === 'Selesai' || s.status === 'Didiskualifikasi') {
      return <span className="text-slate-400 font-bold">-</span>;
    }
    
    // Total duration in minutes
    const durationMin = typeof s.duration === 'number' ? s.duration : (exams[s.examId]?.duration || 0);
    const limitMs = durationMin * 60 * 1000;
    const elapsedMs = now - s.startTime;
    const remainingMs = limitMs - elapsedMs;
    
    if (remainingMs <= 0) {
      return <span className="text-red-600 font-black uppercase tracking-tight text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-100">Waktu Habis</span>;
    }
    
    const secs = Math.floor(remainingMs / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const sec = secs % 60;
    
    let timeStr = '';
    if (h > 0) {
      timeStr = `${h}j ${m}m ${sec}s`;
    } else {
      timeStr = `${m}m ${sec}s`;
    }
    
    const isCrisis = m < 10 && h === 0; // less than 10 mins remaining
    return (
      <div className="flex items-center justify-center space-x-1.5 bg-slate-50 border border-slate-200/60 rounded-lg py-1 px-2.5 max-w-[130px] mx-auto shadow-3xs">
        <Clock3 className={`w-3.5 h-3.5 shrink-0 ${isCrisis ? 'text-red-500 animate-pulse' : 'text-slate-400'}`} />
        <div className="flex flex-col items-center">
          <span className={`font-mono text-[11px] font-black tracking-tight ${isCrisis ? 'text-red-600 animate-pulse' : 'text-slate-700'}`}>
            {timeStr}
          </span>
          <span className="text-[8.5px] text-slate-400 font-medium">dari {Math.round(durationMin)}m</span>
        </div>
      </div>
    );
  };

  const openIndividualDurationModal = (s: StudentSession) => {
    const currentDur = typeof s.duration === 'number' ? s.duration : (exams[s.examId]?.duration || 90);
    const elapsedMin = (Date.now() - s.startTime) / 60000;
    const remainingMin = Math.max(0, Math.ceil(currentDur - elapsedMin));
    setDurationModal({
      isOpen: true,
      mode: 'individual',
      studentSession: s,
      newDuration: remainingMin
    });
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;

  return (
    <div className="w-full flex flex-col h-full space-y-4">
      {/* Refined Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5 text-indigo-400" />
             </div>
             <div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter">Live Monitoring</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                   <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">System Active</p>
                </div>
             </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
             <div className="flex items-center gap-2">
                {filterClass && filterExam && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button 
                      onClick={() => {
                        setFilterClass('');
                        setFilterExam('');
                      }}
                      className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg flex items-center space-x-1 text-[11px] font-black transition-all cursor-pointer shadow-sm"
                    >
                      <ChevronRight className="w-3.5 h-3.5 rotate-180 text-slate-400" />
                      <span>KEMBALI KE DAFTAR UJIAN</span>
                    </button>

                    <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 ml-1">
                      <span className="font-extrabold uppercase">MONITORING:</span>
                      <span className="bg-indigo-50 text-indigo-700 font-extrabold px-2.5 py-0.5 rounded border border-indigo-100 uppercase">{filterClass}</span>
                      <span className="text-slate-350">/</span>
                      <span className="font-extrabold text-slate-700 bg-slate-50 px-2.5 py-0.5 rounded border border-slate-100 uppercase">{exams[filterExam]?.title || 'Ujian'}</span>
                    </div>

                    <button 
                      onClick={() => {
                        const activeSessionsInClass = sessions.filter(
                          s => s.className === filterClass && s.status !== 'Selesai' && s.status !== 'Didiskualifikasi'
                        );
                        let defaultDur = 90;
                        if (activeSessionsInClass.length > 0) {
                          const firstSession = activeSessionsInClass[0];
                          const currentDur = typeof firstSession.duration === 'number' ? firstSession.duration : (exams[firstSession.examId]?.duration || 90);
                          const elapsedMin = (Date.now() - firstSession.startTime) / 60000;
                          defaultDur = Math.max(0, Math.ceil(currentDur - elapsedMin));
                        }
                        setDurationModal({
                          isOpen: true,
                          mode: 'mass',
                          className: filterClass,
                          newDuration: defaultDur || 20
                        });
                      }}
                      className="bg-indigo-600 hover:bg-indigo-750 text-white px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all text-[11px] font-extrabold uppercase shadow-sm cursor-pointer ml-2"
                      title={`Sesuaikan durasi pengerjaan untuk semua siswa kelas ${filterClass}`}
                    >
                      <Clock3 className="w-3.5 h-3.5 text-indigo-200" />
                      <span>Atur Durasi Kelas</span>
                    </button>
                  </div>
                )}
             </div>
          </div>
        </div>
      </div>

       <AnimatePresence mode="wait">
        {(!showAllMode && (!filterClass || !filterExam)) ? (
          <motion.div 
            key="exam-selection-portal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99 }}
            className="flex-1 flex flex-col space-y-5"
          >
            {/* Header section */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
               <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight">PILIH JADWAL UJIAN</h2>
               <p className="text-slate-500 text-[11px] mt-0.5">
                  Pilihlah salah satu daftar jadwal ujian aktif di bawah untuk memantau status fokus peserta secara real-time.
               </p>
            </div>

            {/* Quick Filter Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
               {/* Class Selection Dropdown */}
               <div className="flex items-center gap-2 select-none w-full">
                  <select
                     value={selectedClassFilter}
                     onChange={(e) => {
                        setSelectedClassFilter(e.target.value);
                     }}
                     className="bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-0 focus:border-slate-350 min-w-[150px] cursor-pointer"
                  >
                     <option value="">--Pilih Kelas--</option>
                     {classesData.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                     ))}
                  </select>
               </div>
            </div>

            {/* Conditional List Rendering */}
            {!selectedClassFilter ? (
               <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-450 font-bold text-xs shadow-sm py-20 flex flex-col items-center justify-center space-y-2">
                  <Users className="w-8 h-8 text-slate-350" />
                  <span>Silakan pilih kelas terlebih dahulu untuk menampilkan daftar jadwal ujian.</span>
               </div>
            ) : (
               /* Exams Table List Selection */
               <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden animate-fadeIn">
                  <div className="overflow-x-auto">
                     <table className="w-full text-left border-collapse">
                        <thead>
                           <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-wider border-b border-slate-200 select-none">
                              <th className="px-5 py-3 w-12 text-center">No</th>
                              <th className="px-5 py-3">Ujian & Mata Pelajaran</th>
                              <th className="px-5 py-3 text-center hidden md:table-cell">Paket Soal</th>
                              <th className="px-5 py-3 text-center hidden sm:table-cell">Durasi</th>
                              <th className="px-5 py-3 text-center">Siswa Aktif</th>
                           </tr>
                        </thead>
                        <tbody className="text-xs divide-y divide-slate-100">
                           {(() => {
                               const filteredExamsList = (Object.values(exams) as Exam[])
                                 .filter(ex => ex.targetClass === selectedClassFilter)
                                 .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

                              if (filteredExamsList.length === 0) {
                                 return (
                                    <tr>
                                       <td colSpan={5} className="px-5 py-12 text-center text-slate-400 font-medium">
                                          Tidak ada ujian yang aktif untuk Kelas {selectedClassFilter}.
                                       </td>
                                    </tr>
                                 );
                              }

                              return filteredExamsList.map((ex, idx) => {
                                 const examId = ex.id!;
                                 const activeStudentsCount = sessions.filter(
                                    s => s.examId === examId && s.status !== 'Selesai' && s.status !== 'Didiskualifikasi'
                                 ).length;
                                 const totalLoggedStudents = sessions.filter(s => s.examId === examId).length;
                                 const targetSubject = subjects[ex.subjectId]?.name || 'Mata Pelajaran';

                                 return (
                                    <tr 
                                       key={examId}
                                       onClick={() => {
                                          setFilterClass(ex.targetClass || '');
                                          setFilterExam(examId);
                                       }}
                                       className="hover:bg-slate-50 cursor-pointer transition-colors group"
                                    >
                                       <td className="px-5 py-4 text-center font-bold text-slate-405">
                                          {idx + 1}
                                       </td>
                                       <td className="px-5 py-4">
                                          <div className="font-bold text-slate-800 group-hover:text-indigo-650 transition-colors uppercase tracking-tight">
                                             {ex.title}
                                          </div>
                                          <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                                             {targetSubject.toUpperCase()} {ex.isActive ? `• TOKEN: ${ex.activeToken}` : ''}
                                          </span>
                                       </td>
                                       <td className="px-5 py-4 text-center hidden md:table-cell font-medium text-slate-500">
                                          <div className="truncate max-w-[150px] mx-auto" title={ex.packetName || 'Default'}>
                                             {ex.packetName || 'Default'}
                                          </div>
                                          <span className="text-[9px] text-slate-400">
                                             {ex.questionCount || 0} Soal
                                          </span>
                                       </td>
                                       <td className="px-5 py-4 text-center hidden sm:table-cell font-mono font-medium text-slate-600">
                                          {ex.duration} menit
                                       </td>
                                       <td className="px-5 py-4 text-center">
                                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black ${
                                             activeStudentsCount > 0 
                                             ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                                             : 'bg-slate-100 text-slate-500 border border-slate-200'
                                          }`}>
                                             <span className={`w-1.5 h-1.5 rounded-full ${
                                                activeStudentsCount > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                             }`}></span>
                                             {activeStudentsCount} / {totalLoggedStudents} Siswa
                                          </span>
                                       </td>
                                    </tr>
                                 );
                              });
                           })()}
                        </tbody>
                     </table>
                  </div>
               </div>
            )}
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col flex-1 overflow-hidden"
          >
            <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between sticky top-0 z-20">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                 <LayoutGrid className="w-3 h-3" />
                 {`KELAS ${filterClass.toUpperCase()} - ${(exams[filterExam]?.title || 'UJIAN').toUpperCase()}`}
               </span>
               <span className="text-[10px] font-bold text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-100 shadow-sm">
                 {filteredSessions.length} Terdeteksi
               </span>
            </div>
            
            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100 sticky top-0 z-10">
                    <th className="px-6 py-4 w-12 text-center">No</th>
                    <th className="px-4 py-4">Peserta</th>
                    <th className="px-4 py-4 text-center">Kelas</th>
                    <th className="px-4 py-4">Data Ujian</th>
                    <th className="px-4 py-4 text-center">Sisa Waktu</th>
                    <th className="px-4 py-4 text-center">Status Keamanan</th>
                    <th className="px-4 py-4 text-center">Progres Status</th>
                    <th className="px-6 py-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-24 text-center bg-slate-50/20">
                        <div className="flex flex-col items-center justify-center space-y-2 py-6">
                           <Users className="w-8 h-8 text-slate-350 animate-pulse" />
                           <p className="font-extrabold text-slate-500 uppercase tracking-tight text-xs">Belum Ada Peserta</p>
                           <p className="text-slate-400 text-[11px] max-w-sm mx-auto">
                              Belum ada peserta yang masuk atau memulai pengerjaan untuk ujian ini. Silakan arahkan peserta untuk masuk dan memulai ujian.
                           </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map((s, idx) => {
                      const isWarning = s.violationsCount > 0 && s.status === 'Aktif';
                      const isOffline = (Date.now() - s.lastActivity) > 60000 && s.status === 'Aktif' && s.lastActivity > 0;
                      const isWaitingLogin = s.status === 'Aktif' && s.lastActivity === 0;
                      
                      return (
                        <tr key={s.id} className={`group border-b border-slate-50 hover:bg-slate-50 transition-colors ${isWarning ? 'bg-orange-50/50' : ''} ${s.status === 'Melanggar' ? 'bg-red-50/30' : ''}`}>
                          <td className="px-6 py-4 text-center text-slate-300 font-mono text-[11px]">{idx + 1}</td>
                          <td className="px-4 py-4">
                            <div className="font-bold text-slate-800 text-sm">{s.studentName}</div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="text-[10px] font-bold text-slate-500 bg-slate-100 inline-block px-1.5 rounded uppercase">{s.className}</div>
                          </td>
                          <td className="px-4 py-4">
                             <div className="font-bold text-slate-600 text-[11px] line-clamp-1 mb-0.5">{exams[s.examId]?.title || 'Unknown Exam'}</div>
                             <div className="text-[9px] text-slate-400 font-bold uppercase">{subjects[s.subjectId]?.name || 'Unknown Subject'}</div>
                          </td>
                          <td className="px-4 py-4 text-center">
                             <div className="flex items-center justify-center gap-1.5 min-w-[120px]">
                               {getRemainingTimeDisplay(s)}
                               {s.status !== 'Selesai' && s.status !== 'Didiskualifikasi' && (
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     openIndividualDurationModal(s);
                                   }}
                                   className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer shrink-0"
                                   title="Ubah Durasi Murid"
                                 >
                                   <Clock3 className="w-3.5 h-3.5" />
                                 </button>
                               )}
                             </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                             <div className="flex flex-col items-center gap-1 justify-center">
                               {false ? (
                              <div className="inline-flex flex-col items-center gap-1 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200 text-center max-w-[180px] mx-auto shadow-3xs">
                                <div className="flex items-center gap-1 text-amber-700 font-extrabold text-[9px] uppercase tracking-wider">
                                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span>Akses Dipulihkan</span>
                                </div>
                                <span className="text-[8.5px] text-slate-600 font-medium leading-normal">
                                  Peserta ini sempat didiskualifikasi dari ujian, namun kembali diberikan izin melanjutkan pengerjaan hingga selesai oleh pengawas/admin.
                                </span>
                              </div>
                            ) : s.violationsCount > 0 ? (
                              <div className="inline-flex items-center gap-1.5">
                                <ShieldAlert className={`w-3.5 h-3.5 ${s.violationsCount >= 3 ? 'text-red-600 animate-bounce' : 'text-orange-500'}`} />
                                <span className={`font-black text-[11px] ${s.violationsCount >= 3 ? 'text-red-700' : 'text-orange-700'}`}>
                                  {s.violationsCount} Pelanggaran
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-emerald-600 font-black bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-tight">Normal</span>
                             )}
                             {s.wasDisqualified && s.status === 'Selesai' && (
                               <span className="inline-flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded shadow-3xs" title="Siswa sempat didiskualifikasi, namun diizinkan melanjutkan pengerjaan kembali oleh pengawas.">
                                 <CheckCircle2 className="w-3 h-3 text-blue-500 shrink-0" />
                                 <span>Akses Dipulihkan</span>
                               </span>
                             )}
                             </div>
                             {false && (
                               <span>Normal</span>
                            )}
                          </td>
                          <td className="px-4 py-4 text-center">
                            {(() => {
                              if (s.status === 'Didiskualifikasi') {
                                return (
                                  <div className="flex flex-col items-center">
                                    <ShieldAlert className="w-4 h-4 text-red-600 mb-0.5" />
                                    <span className="text-[9px] font-black text-red-600 uppercase tracking-tighter">Diskualifikasi</span>
                                  </div>
                                );
                              }

                              if (isWaitingLogin) {
                                return (
                                  <div className="flex flex-col items-center">
                                    <Users className="w-4 h-4 text-indigo-400 mb-0.5" />
                                    <span className="text-[9px] font-black text-indigo-500 uppercase tracking-tighter">Menunggu Login</span>
                                    {s.wasDisqualified && (
                                      <span className="text-[7px] text-emerald-600 font-black uppercase tracking-wider bg-emerald-50 px-1.5 rounded mt-0.5 border border-emerald-100 shadow-3xs">Restorasi Akses</span>
                                    )}
                                  </div>
                                );
                              }
                              
                              if (s.status === 'Selesai') {
                                const ansLen = Object.keys(s.answers || {}).length;
                                const total = exams[s.examId]?.questionCount || 0;
                                const isAll = ansLen >= total && total > 0;
                                return (
                                  <div className="flex flex-col items-center">
                                    <CheckCircle2 className={`w-4 h-4 mb-0.5 ${isAll ? 'text-emerald-500' : 'text-blue-500'}`} />
                                    <span className={`text-[9px] font-black uppercase tracking-tighter ${isAll ? 'text-emerald-600' : 'text-blue-600'}`}>
                                      Selesai
                                    </span>
                                  </div>
                                );
                              }

                              return (
                                <div className="flex flex-col items-center">
                                  <Clock3 className={`w-4 h-4 mb-0.5 ${isOffline ? 'text-red-400' : 'text-emerald-400'}`} />
                                  <div className="flex flex-col items-center">
                                    <span className={`text-[9px] font-black uppercase tracking-tighter ${isOffline ? 'text-red-500' : 'text-emerald-500'}`}>
                                      {isOffline ? 'Terputus' : 'Mengerjakan'}
                                    </span>
                                    {s.wasDisqualified && (
                                      <span className="text-[7px] text-indigo-600 font-black uppercase tracking-wider bg-indigo-50 px-1.5 rounded mt-0.5 border border-indigo-100 shadow-3xs">Akses Lanjutan</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4 text-center">
                             <div className="flex items-center justify-center gap-2">
                                {s.status === 'Didiskualifikasi' && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerRestore(s);
                                    }} 
                                    className="h-8 w-8 flex items-center justify-center bg-emerald-600 text-white hover:bg-emerald-700 hover:scale-105 active:scale-95 border-none rounded-lg transition-all shadow-md shadow-emerald-100 group animate-in zoom-in-50 duration-200 shrink-0" 
                                    title="Pulihkan akses & Izinkan Melanjutkan"
                                  >
                                    <Unlock className="w-4 h-4 text-white" />
                                  </button>
                                )}
                                <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openMonitor(s);
                                    }} 
                                    className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all" 
                                    title="Detail Monitor"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                  {s.status !== 'Selesai' && s.status !== 'Didiskualifikasi' ? (
                                    <>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          triggerWarning(s);
                                        }} 
                                        className={`h-7 px-2.5 rounded-md text-[9px] font-black uppercase tracking-tight transition-all ${s.status === 'Melanggar' || s.violationsCount > 0 ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                                      >
                                        Tegur
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          triggerEndExam(s);
                                        }} 
                                        className="h-7 w-7 flex items-center justify-center text-red-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-all" 
                                        title="Diskualifikasi Paksa"
                                      >
                                        <Ban className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        triggerDelete(s.id!, s.studentName);
                                      }} 
                                      className="h-7 w-7 flex items-center justify-center text-red-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all" 
                                      title="Hapus Sesi"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                             </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Detail */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-blue-600" />
                Detail Monitoring: {selectedSession.studentName}
              </h3>
              <button onClick={() => setSelectedSession(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
                 <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto w-full">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Status</p>
                  <div>{getStatusBadge(selectedSession.status)}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Pelanggaran</p>
                  <p className="text-lg font-bold text-red-600">{selectedSession.violationsCount}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 md:col-span-2">
                   <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Aktivitas Terakhir</p>
                   <p className="text-sm font-medium text-slate-800">
                     {new Date(selectedSession.lastActivity).toLocaleTimeString()}
                     {Date.now() - selectedSession.lastActivity > 60000 ? ' (Kemungkinan Offline)' : ' (Online)'}
                   </p>
                </div>
              </div>

              <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center">
                <ShieldAlert className="w-4 h-4 mr-2" /> Log Pelanggaran & Aktivitas
              </h4>
              
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                {sessionViolations.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Belum ada pelanggaran yang tercatat. Siswa teladan.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-200">
                    {sessionViolations.map((v, i) => (
                      <li key={i} className="p-4 flex items-start space-x-3 hover:bg-white transition-colors">
                        <div className="mt-0.5">
                          {v.type === 'Peringatan Admin' ? <AlertTriangle className="w-4 h-4 text-orange-500" /> : <BadgeAlert className="w-4 h-4 text-red-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800 mb-0.5">{v.type}</p>
                          <p className="text-xs text-slate-500 mb-1">{new Date(v.timestamp).toLocaleTimeString()}</p>
                          {v.status && <p className="text-sm text-slate-600 bg-slate-100 p-2 rounded mt-1 border border-slate-200">{v.status}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end space-x-3">
              {selectedSession.status === 'Didiskualifikasi' && (
                <button onClick={() => triggerRestore(selectedSession)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors text-sm shadow-sm flex items-center">
                  <Play className="w-4 h-4 mr-2" /> Pulihkan & Lanjutkan Ujian
                </button>
              )}
              {selectedSession.status !== 'Selesai' && selectedSession.status !== 'Didiskualifikasi' && (
                <>
                  <button onClick={() => triggerWarning(selectedSession)} className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 font-medium rounded-lg transition-colors text-sm">
                    Kirim Peringatan
                  </button>
                  <button onClick={() => triggerEndExam(selectedSession)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors text-sm shadow-sm flex items-center">
                    <MonitorOff className="w-4 h-4 mr-2" /> Akhiri Ujian (Diskualifikasi)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-slate-900 border border-slate-800 text-white font-medium text-xs px-3.5 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>{toast}</span>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-100 p-5 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
              confirmDialog.type === 'delete' ? 'bg-red-50 text-red-600' :
              confirmDialog.type === 'end_exam' ? 'bg-red-50 text-red-600' : 
              confirmDialog.type === 'restore' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {confirmDialog.type === 'delete' || confirmDialog.type === 'end_exam' ? (
                <ShieldAlert className="w-6 h-6" />
              ) : confirmDialog.type === 'restore' ? (
                <Play className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">
              {confirmDialog.type === 'delete' ? 'Hapus Sesi Ujian' :
               confirmDialog.type === 'end_exam' ? 'Akhiri Paksa Ujian' : 
               confirmDialog.type === 'restore' ? 'Pulihkan Sesi Ujian' : 'Kirim Teguran'}
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              {confirmDialog.type === 'delete' && `Apakah Anda yakin ingin menghapus data sesi ujian untuk ${confirmDialog.candidateName}? Tindakan ini tidak dapat dibatalkan.`}
              {confirmDialog.type === 'end_exam' && `Apakah Anda yakin ingin mengakhiri paksa ujian untuk ${confirmDialog.candidateName}? Mereka akan didiskualifikasi.`}
              {confirmDialog.type === 'warning' && `Kirim peringatan/teguran kedisiplinan ke siswa ${confirmDialog.candidateName}?`}
              {confirmDialog.type === 'restore' && `Izinkan ${confirmDialog.candidateName} untuk melanjutkan kembali ujian yang sebelumnya didiskualifikasi?`}
            </p>
            <div className="flex gap-2 w-full">
              <button 
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={executeConfirmedAction} 
                className={`flex-1 px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors ${
                  confirmDialog.type === 'delete' || confirmDialog.type === 'end_exam' 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : confirmDialog.type === 'restore'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                {confirmDialog.type === 'delete' ? 'Hapus' :
                 confirmDialog.type === 'end_exam' ? 'Akhiri' : 
                 confirmDialog.type === 'restore' ? 'Izinkan' : 'Kirim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Duration Adjustment Modal */}
      {durationModal.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-100 p-5 flex flex-col animate-in scale-in duration-200">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Clock3 className="w-5 h-5 animate-pulse" />
              </div>
              <div className="text-left">
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-tight">
                  {durationModal.mode === 'individual' ? 'Sesuaikan Durasi Murid' : 'Atur Durasi Massal Kelas'}
                </h4>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  {durationModal.mode === 'individual' ? durationModal.studentSession?.studentName : `Kelas ${durationModal.className}`}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-slate-500 text-left leading-relaxed mb-4 font-medium">
              {durationModal.mode === 'individual' 
                ? `Atur sisa batas durasi pengerjaan ujian untuk murid ini dalam satuan menit. Perubahan akan langsung aktif secara real time.`
                : `Atur sisa batas durasi ujian untuk seluruh siswa aktif di kelas ${durationModal.className}. Seluruh siswa aktif akan memiliki sisa durasi pengerjaan yang sama rata, secara real time.`
              }
            </p>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-5 text-center">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Sisa Durasi Ujian Baru (Menit)</label>
              <div className="flex items-center justify-center space-x-4">
                <button 
                  type="button"
                  onClick={() => setDurationModal(prev => ({ ...prev, newDuration: Math.max(5, prev.newDuration - 5) }))}
                  className="w-8 h-8 rounded bg-white hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-black text-slate-600 active:scale-95 transition-all outline-none cursor-pointer"
                >
                  -5
                </button>
                <input 
                  type="number"
                  min={5}
                  value={durationModal.newDuration}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 5;
                    setDurationModal(prev => ({ ...prev, newDuration: val }));
                  }}
                  className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-center text-sm font-bold focus:ring-1 focus:ring-indigo-500 text-slate-800 outline-none"
                />
                <button 
                  type="button"
                  onClick={() => setDurationModal(prev => ({ ...prev, newDuration: prev.newDuration + 5 }))}
                  className="w-8 h-8 rounded bg-white hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-black text-slate-600 active:scale-95 transition-all outline-none cursor-pointer"
                >
                  +5
                </button>
              </div>
            </div>

            <div className="flex gap-2 w-full">
              <button 
                type="button"
                onClick={() => setDurationModal(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button 
                type="button"
                onClick={handleSaveDuration} 
                className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm cursor-pointer"
              >
                Simpan Durasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
