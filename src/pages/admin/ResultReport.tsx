import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, getDoc, orderBy, where, doc, deleteDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { StudentSession, Exam, Question, Class, Subject, Setting, AudioItem } from '../../types';
import { Loader2, FileSpreadsheet, Trash2, Award, CheckCircle2, XCircle, X, Check, Clock, Users, Search, LayoutGrid, Music } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { formatHTML, calculateSmartPoints, normalizeTextForGrading, calculatePgkPoints } from '../../utils/textFormat';
import { deduplicateStudentSessions } from '../../utils/sessionUtils';
import { renderMathInContainers } from '../../utils/mathRenderer';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const isOptionEmpty = (val: string | undefined | null): boolean => {
  if (!val) return true;
  const str = String(val).trim();
  if (/<(img|audio|video|iframe|svg|math)/i.test(str)) {
    return false;
  }
  const plainText = str.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
  return plainText === '';
};

export default function ResultReport() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [exams, setExams] = useState<Record<string, Exam>>({});
  const [classesData, setClassesData] = useState<Class[]>([]);
  const [subjectsMap, setSubjectsMap] = useState<Record<string, string>>({});
  const [audioNames, setAudioNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState<string>('');
  const [filterExam, setFilterExam] = useState<string>('');
  const [allClassSessions, setAllClassSessions] = useState<StudentSession[]>([]);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [sortBy, setSortBy] = useState<string>('waktu_terbaru');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [dummyTrigger, setDummyTrigger] = useState<number>(0);

  const sortedSessions = useMemo(() => {
    let list = [...sessions];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => (s.studentName || '').toLowerCase().includes(q));
    }
    if (sortBy === 'waktu_terbaru') {
      list.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
    } else if (sortBy === 'waktu_terlama') {
      list.sort((a, b) => (a.endTime || 0) - (b.endTime || 0));
    } else if (sortBy === 'skor_tertinggi') {
      list.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'skor_terendah') {
      list.sort((a, b) => (a.score || 0) - (b.score || 0));
    } else if (sortBy === 'nama_asc') {
      list.sort((a, b) => (a.studentName || '').toLowerCase().localeCompare((b.studentName || '').toLowerCase()));
    } else if (sortBy === 'nama_desc') {
      list.sort((a, b) => (b.studentName || '').toLowerCase().localeCompare((a.studentName || '').toLowerCase()));
    }
    return list;
  }, [sessions, sortBy, searchQuery]);

  // Toast & Custom Delete Confirmation Dialog
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  const [confirmDelete, setConfirmDelete] = useState<{
    isOpen: boolean;
    id: string;
    studentName: string;
  }>({
    isOpen: false,
    id: '',
    studentName: ''
  });

  const [confirmDeleteExam, setConfirmDeleteExam] = useState<{
    isOpen: boolean;
    examId: string;
  }>({
    isOpen: false,
    examId: ''
  });

  // Grading Modal States
  const [selectedSession, setSelectedSession] = useState<StudentSession | null>(null);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [editingScores, setEditingScores] = useState<Record<string, number>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [savingGrades, setSavingGrades] = useState(false);

  const handleOpenGradingModal = async (session: StudentSession) => {
    setSelectedSession(session);
    setLoadingQuestions(true);
    setEditingScores(session.essayScores || {});
    setSessionQuestions([]);
    try {
      const examObj = exams[session.examId];
      const targetPacket = session.packetName || examObj?.packetName;
      let qQuery;
      if (targetPacket) {
        qQuery = query(collection(db, 'questions'), 
          where('subjectId', '==', session.subjectId),
          where('packetName', '==', targetPacket)
        );
      } else {
        qQuery = query(collection(db, 'questions'), where('subjectId', '==', session.subjectId));
      }
      
      const qSnap = await getDocs(qQuery);
      const qs = qSnap.docs.map(d => {
        const data = d.data() as any;
        let qType = data.type;
        const tCode = data.typeCode;
        if (qType === 1 || qType === '1' || tCode === 1) {
          qType = 'pilihan_ganda';
        } else if (qType === 2 || qType === '2' || tCode === 2) {
          qType = 'listening';
        } else if (qType === 3 || qType === '3' || tCode === 3) {
          qType = 'essay';
        } else if (qType === 4 || qType === '4' || tCode === 4 || qType === 5 || qType === '5' || tCode === 5) {
          qType = 'pilihan_ganda_kompleks';
        } else if (!qType) {
          qType = 'pilihan_ganda';
        }
        return {
          id: d.id,
          ...data,
          type: qType,
          typeCode: tCode || (qType === 'pilihan_ganda_kompleks' ? 4 : qType === 'listening' ? 2 : qType === 'essay' ? 3 : 1)
        } as Question;
      });
      
      const typeOrder: Record<string, number> = { 'pilihan_ganda': 1, 'listening': 2, 'essay': 3, 'pilihan_ganda_kompleks': 4, 'isian_singkat': 5 };
      const sortedQs = qs.sort((a, b) => {
        const aType = a.type || 'pilihan_ganda';
        const bType = b.type || 'pilihan_ganda';
        if (typeOrder[aType] !== typeOrder[bType]) {
          return typeOrder[aType] - typeOrder[bType];
        }
        return (a.number || 0) - (b.number || 0);
      });
      
      setSessionQuestions(sortedQs);
    } catch (e) {
      console.error(e);
      showToast('Gagal memuat detail pertanyaan');
    }
    setLoadingQuestions(false);
  };

  const handleSaveEssayGrades = async () => {
    if (!selectedSession) return;
    setSavingGrades(true);

    try {
      let pointsEarned = 0;
      let totalWeight = 0;
      
      const studentAnswers = selectedSession.answers || {};

      sessionQuestions.forEach(q => {
        const isEssay = q.type === 'essay';
        const weight = q.weight || 10;
        totalWeight += weight;

        if (q.type === 'pilihan_ganda' || q.type === 'listening') {
          if (studentAnswers[q.id!] === q.correctAnswer) {
            pointsEarned += weight;
          }
        } else if (q.type === 'pilihan_ganda_kompleks') {
          const manualScore = editingScores[q.id!];
          if (manualScore !== undefined) {
            pointsEarned += manualScore;
          } else {
            const availCount = ['A', 'B', 'C', 'D', 'E'].filter(l => !isOptionEmpty((q as any)[`option${l}`])).length || 5;
            const pgk = calculatePgkPoints(studentAnswers[q.id!], q.correctAnswer, weight, availCount);
            pointsEarned += pgk.earned;
          }
        } else if (q.type === 'isian_singkat') {
          // For short answer, if admin changed manual score use it, otherwise use smart auto score
          const manualScore = editingScores[q.id!];
          if (manualScore !== undefined) {
            pointsEarned += manualScore;
          } else {
            pointsEarned += calculateSmartPoints(studentAnswers[q.id!] || '', q.correctAnswer || '', weight);
          }
        } else if (isEssay) {
          // For essay, if admin changed manual score use it, otherwise use smart auto score
          const manualScore = editingScores[q.id!];
          if (manualScore !== undefined) {
            pointsEarned += manualScore;
          } else {
            pointsEarned += calculateSmartPoints(studentAnswers[q.id!] || '', q.correctAnswer || '', weight);
          }
        }
      });

      const rootScore = totalWeight > 0 ? (pointsEarned / totalWeight) * 100 : 0;

      await updateDoc(doc(db, 'student_sessions', selectedSession.id!), {
        essayScores: editingScores,
        score: rootScore,
        lastGradedAt: Date.now()
      });

      showToast('Koreksi jawaban berhasil disimpan!');
      setSelectedSession(null);
      fetchResults();
    } catch (err) {
      console.error(err);
      showToast('Gagal menyimpan nilai koreksi.');
    }
    setSavingGrades(false);
  };

  useEffect(() => {
    if (user) {
      fetchExams();
      fetchClasses();
      fetchSubjects();
      fetchAudioNames();
      fetchSettings();
    }
  }, [user]);

  const fetchAudioNames = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'audio_banks'), where('adminId', '==', user.uid)));
      const map: Record<string, string> = {};
      snap.docs.forEach(d => {
        const data = d.data() as AudioItem;
        map[d.id] = data.name;
      });
      setAudioNames(map);
    } catch (e) {
      console.error('Error fetching audio names:', e);
    }
  };

  const fetchSettings = async () => {
    if (!user) return;
    try {
      const docRef = doc(db, 'settings', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setSetting(docSnap.data() as Setting);
      } else {
        const fallbackRef = doc(db, 'settings', 'school');
        const fallbackSnap = await getDoc(fallbackRef);
        if (fallbackSnap.exists()) {
          setSetting(fallbackSnap.data() as Setting);
        }
      }
    } catch (e) {
      console.error('Error fetching settings:', e);
    }
  };

  const fetchSubjects = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'subjects'), where('adminId', '==', user.uid)));
      const map: Record<string, string> = {};
      snap.docs.forEach(d => {
        const data = d.data() as Subject;
        map[d.id] = data.name;
      });
      setSubjectsMap(map);
    } catch (e) {
      console.error('Error fetching subjects:', e);
    }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    
    // Fetch all classes static comparison first if filterClass is selected
    if (filterClass) {
      const baseQ = query(
        collection(db, 'student_sessions'),
        where('adminId', '==', user.uid),
        where('className', '==', filterClass)
      );
      getDocs(baseQ).then(baseSnap => {
        const allClassSess = baseSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
        setAllClassSessions(deduplicateStudentSessions(allClassSess));
      }).catch(e => console.error(e));
    } else {
      setAllClassSessions([]);
    }

    let q = query(
      collection(db, 'student_sessions'), 
      where('adminId', '==', user.uid),
      where('status', 'in', ['Selesai', 'Didiskualifikasi'])
    );
    if (filterClass) {
        q = query(q, where('className', '==', filterClass));
    }
    if (filterExam) {
       q = query(q, where('examId', '==', filterExam));
    }

    const unsub = onSnapshot(q, (snap) => {
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
      let deduplicatedData = deduplicateStudentSessions(data);
      // Manual sort since compound index might fail without setup
      deduplicatedData.sort((a,b) => (b.endTime || 0) - (a.endTime || 0));
      setSessions(deduplicatedData);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });

    return () => unsub();
  }, [filterExam, filterClass, user, dummyTrigger]);

  useEffect(() => {
    const render = () => {
      renderMathInContainers('.ql-editor');
    };
    render();
    const frameId = requestAnimationFrame(render);
    const timerId = setTimeout(render, 50);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [selectedSession, sessions, exams, sessionQuestions]);

  const fetchClasses = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'classes'), where('adminId', '==', user.uid)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Class));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesData(list);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchExams = async () => {
    if (!user) return;
    try {
      const snap = await getDocs(query(collection(db, 'exams'), where('adminId', '==', user.uid)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const map: Record<string, Exam> = {};
      list.forEach(d => map[d.id!] = d);
      setExams(map);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchResults = async () => {
    setDummyTrigger(prev => prev + 1);
  };

  const handleExportExcel = () => {
    const format24hInput = (timestamp: number) => {
      const d = new Date(timestamp);
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return `${dateStr} ${timeStr}`;
    };

    const getDurationText = (s: StudentSession) => {
      if (s.status === 'Didiskualifikasi') return '-';
      if (!s.startTime) return '-';
      const end = s.endTime || Date.now();
      const diffMs = end - s.startTime;
      if (diffMs <= 0) return '0 detik';
      const totalSecs = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const sPart = totalSecs % 60;
      if (h > 0) return `${h} jam ${m} menit ${sPart} detik`;
      if (m > 0) return `${m} menit ${sPart} detik`;
      return `${sPart} detik`;
    };

    const schoolName = setting?.schoolName || 'NAMA SEKOLAH BELUM DIKONFIGURASI';
    const schoolAddress = setting?.schoolAddress || 'Alamat sekolah tidak ditentukan';
    const schoolSlogan = setting?.schoolSlogan || '';
    const teacherName = setting?.teacherName || user?.displayName || 'GURU PENGAMPU';
    const teacherRole = setting?.teacherRole || 'Guru Pengajar';

    let subjectName = 'Semua Mata Pelajaran';
    if (filterExam && exams[filterExam]) {
      const examObj = exams[filterExam];
      if (examObj.subjectId && subjectsMap[examObj.subjectId]) {
        subjectName = subjectsMap[examObj.subjectId];
      }
    } else if (sortedSessions.length > 0) {
      const firstSess = sortedSessions[0];
      if (firstSess.subjectId && subjectsMap[firstSess.subjectId]) {
        subjectName = subjectsMap[firstSess.subjectId];
      }
    }

    const aoa: any[][] = [];

    // Header info (simple, clean and matching screenshot exactly)
    aoa.push([]); // Row 0 spacer
    aoa.push(['', 'REKAPITULASI DAFTAR NILAI EVALUASI BELAJAR SISWA']); // Row 1
    aoa.push([]); // Row 2 spacer

    const nowFormatted = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    aoa.push(['', 'INFORMASI AKADEMIK', '', '', 'DETAIL REKAPITULASI']); // Row 3
    aoa.push(['', 'Nama Guru Pengampu', `: ${teacherName}`, '', 'Mata Pelajaran', `: ${subjectName}`]); // Row 4
    aoa.push(['', 'Jabatan / Peran', `: ${teacherRole}`, '', 'Kelas', `: ${filterClass || 'Semua Kelas'}`]); // Row 5
    if (filterExam && exams[filterExam]) {
      aoa.push(['', 'Jadwal Ujian', `: ${exams[filterExam].title}`, '', 'Total Peserta', `: ${sortedSessions.length} Siswa`]); // Row 6
      aoa.push(['', 'Tanggal Unduh Laporan', `: ${nowFormatted}`]); // Row 7
    } else {
      aoa.push(['', 'Tanggal Unduh Laporan', `: ${nowFormatted}`, '', 'Total Peserta', `: ${sortedSessions.length} Siswa`]); // Row 6
    }
    aoa.push([]); // Row 7/8 spacer
    aoa.push([]); // Row 8/9 spacer

    // Table Headers
    aoa.push([
      'NO',
      'NAMA LENGKAP SISWA',
      'KELAS',
      'UJIAN / JADWAL',
      'PAKET SOAL',
      'STATUS KEIKUTSERTAAN',
      'NILAI (SKOR)',
      'JAWABAN BENAR',
      'JAWABAN SALAH',
      'PELANGGARAN',
      'DURASI PENGERJAAN',
      'WAKTU MULAI',
      'WAKTU SELESAI'
    ]);

    // Records
    sortedSessions.forEach((s, idx) => {
      aoa.push([
        idx + 1,
        s.studentName.toUpperCase(),
        s.className,
        s.examTitle || exams[s.examId]?.title || (subjectsMap[s.subjectId] ? `Ujian ${subjectsMap[s.subjectId]}` : 'Ujian'),
        s.packetName || '-',
        s.status === 'Didiskualifikasi' ? 'DIDISKUALIFIKASI' : s.status.toUpperCase(),
        s.score !== undefined ? Number(s.score.toFixed(2)) : 0,
        s.correctCount || 0,
        s.wrongCount || 0,
        s.violationsCount || 0,
        getDurationText(s),
        format24hInput(s.startTime),
        s.endTime ? format24hInput(s.endTime) : '-'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply merges to look like the screenshot layout
    const merges: XLSX.Range[] = [
      { s: { r: 1, c: 1 }, e: { r: 1, c: 12 } },
      { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } },
      { s: { r: 3, c: 4 }, e: { r: 3, c: 6 } },
      { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } },
      { s: { r: 4, c: 5 }, e: { r: 4, c: 12 } },
      { s: { r: 5, c: 2 }, e: { r: 5, c: 3 } },
      { s: { r: 5, c: 5 }, e: { r: 5, c: 12 } },
      { s: { r: 6, c: 2 }, e: { r: 6, c: 3 } },
      { s: { r: 6, c: 5 }, e: { r: 6, c: 12 } },
    ];

    if (filterExam && exams[filterExam]) {
      merges.push({ s: { r: 7, c: 2 }, e: { r: 7, c: 5 } });
    }

    ws['!merges'] = merges;

    // Align column widths beautifully
    ws['!cols'] = [
      { wch: 6 },   // NO
      { wch: 32 },  // NAMA LENGKAP SISWA
      { wch: 12 },  // KELAS
      { wch: 28 },  // UJIAN / JADWAL
      { wch: 18 },  // PAKET SOAL
      { wch: 22 },  // STATUS KEIKUTSERTAAN
      { wch: 14 },  // Nilai (Skor)
      { wch: 16 },  // Jawaban Benar
      { wch: 16 },  // Jawaban Salah
      { wch: 14 },  // Pelanggaran
      { wch: 24 },  // Durasi Kerja
      { wch: 22 },  // Waktu Mulai
      { wch: 22 }   // Waktu Selesai
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hasil Ujian');
    
    // Nice descriptive filename
    const cleanSchoolName = schoolName.replace(/[^a-zA-Z0-9]/g, '_');
    XLSX.writeFile(wb, `Laporan_Ujian_${cleanSchoolName}_${new Date().getTime()}.xlsx`);
  };

  const getDurationDisplay = (s: StudentSession) => {
    if (s.status === 'Didiskualifikasi') {
      return '-';
    }
    if (!s.startTime) return '-';
    const end = s.endTime || Date.now();
    const diffMs = end - s.startTime;
    if (diffMs <= 0) return '0 detik';
    
    const totalSecs = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const sPart = totalSecs % 60;
    
    if (h > 0) return `${h} jam ${m} menit ${sPart} detik`;
    if (m > 0) return `${m} menit ${sPart} detik`;
    return `${sPart} detik`;
  };

  const triggerDelete = (id: string, name: string) => {
    setConfirmDelete({
      isOpen: true,
      id,
      studentName: name
    });
  };

  const executeDelete = async () => {
    const { id } = confirmDelete;
    setConfirmDelete(prev => ({ ...prev, isOpen: false }));
    try {
      await deleteDoc(doc(db, 'student_sessions', id));
      // Refresh local list
      setSessions(prev => prev.filter(s => s.id !== id));
      setAllClassSessions(prev => prev.filter(s => s.id !== id));
      showToast('Hasil ujian berhasil dihapus');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'student_sessions');
    }
  };

  const executeDeleteExamResults = async () => {
    const { examId } = confirmDeleteExam;
    if (!examId) return;
    setConfirmDeleteExam(prev => ({ ...prev, isOpen: false }));
    setLoading(true);
    try {
      const q = query(
        collection(db, 'student_sessions'), 
        where('adminId', '==', user.uid),
        where('examId', '==', examId)
      );
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);
      
      try {
        await deleteDoc(doc(db, 'exams', examId));
      } catch (examErr) {
        console.warn("Exam doc already deleted or permission skipped:", examErr);
      }
      
      // Update local states immediately
      setExams(prev => {
        const newExams = { ...prev };
        delete newExams[examId];
        return newExams;
      });

      setSessions(prev => prev.filter(s => s.examId !== examId));
      setAllClassSessions(prev => prev.filter(s => s.examId !== examId));
      
      if (filterExam === examId) setFilterExam('');

      showToast('File soal dan seluruh hasil ujian terkait berhasil dihapus');
    } catch (err) {
      console.error(err);
      showToast('Gagal menghapus hasil ujian');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full flex-1 flex flex-col h-full min-h-0">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Hasil Ujian</h3>
          <div className="flex items-center space-x-2">
             <select
               value={filterClass}
               onChange={e => {
                 setFilterClass(e.target.value);
                 setFilterExam(''); // reset exam filter on class change
               }}
               className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-bold uppercase focus:ring-1 focus:ring-blue-500 outline-none"
             >
               <option value="">--pilih kelas--</option>
               {classesData.map((c) => (
                 <option key={c.id} value={c.name}>{c.name}</option>
               ))}
             </select>

             {filterClass && filterExam && (
               <button
                 onClick={() => setFilterExam('')}
                 className="px-2 py-1.5 bg-blue-50 text-blue-600 border border-blue-100 rounded text-[10px] font-bold uppercase hover:bg-blue-100 transition-colors flex items-center gap-1.5"
               >
                 <X className="w-3 h-3" />
                 <span>Ganti File Soal</span>
               </button>
             )}

             {filterClass && filterExam && (
               <select
                 value={sortBy}
                 onChange={e => setSortBy(e.target.value)}
                 className="px-2 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded text-[11px] font-bold uppercase focus:ring-1 focus:ring-blue-500 outline-none hover:bg-blue-100 transition-all cursor-pointer"
               >
                 <option value="waktu_terbaru">⚡ Terbaru</option>
                 <option value="waktu_terlama">⏳ Terlama</option>
                 <option value="skor_tertinggi">📈 Skor Tertinggi</option>
                 <option value="skor_terendah">📉 Skor Terendah</option>
                 <option value="nama_asc">🔤 Nama A-Z</option>
                 <option value="nama_desc">🔤 Nama Z-A</option>
               </select>
             )}
             <button 
               disabled={sortedSessions.length === 0 || !filterClass || !filterExam}
               onClick={handleExportExcel}
               className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors text-[10px] font-bold uppercase shadow-sm disabled:opacity-50"
             >
               <FileSpreadsheet className="w-3.5 h-3.5" />
               <span>Export Excel</span>
             </button>
          </div>
        </div>

         <div className="overflow-auto flex-1 p-0">
           {!filterClass ? (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center h-full text-slate-400 py-20 px-6 text-center"
              >
                <div className="relative mb-6">
                  <div className="w-20 h-20 bg-slate-100 rounded-[2rem] flex items-center justify-center shadow-inner">
                    <Users className="w-10 h-10 text-slate-300" />
                  </div>
                </div>
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest mb-2">Silakan Pilih Kelas</h4>
                <p className="text-xs max-w-xs leading-relaxed text-slate-500 font-medium">Buka menu pilihan di pojok kanan atas untuk memfilter data berdasarkan kelas siswa.</p>
              </motion.div>
           ) : !filterExam ? (
              <div className="p-8 bg-slate-50 min-h-full">
                <div className="max-w-4xl mx-auto">
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-4 mb-8"
                  >
                    <div className="p-3.5 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-200">
                      <LayoutGrid className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-base font-black text-slate-800 uppercase tracking-tight">Pilih File Soal</h4>
                      <p className="text-[11px] text-slate-500 font-bold mt-1 uppercase tracking-wider">
                        Hasil Ujian Kelas: <span className="text-blue-600 font-black">{filterClass}</span>
                      </p>
                    </div>
                  </motion.div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {(() => {
                        const classExams = (Object.entries(exams) as [string, Exam][]).filter(([id, ex]) => ex.targetClass === filterClass);
                        const deletedExamIds = Array.from(new Set(allClassSessions.map(s => s.examId))).filter(id => !exams[id]);
                        
                        const mergedExams = [
                          ...classExams,
                          ...deletedExamIds.map(id => {
                            const session = allClassSessions.find(s => s.examId === id);
                            const subjName = session?.subjectId ? subjectsMap[session.subjectId] : '';
                            return [id, {
                              id,
                              title: session?.examTitle || session?.packetName || (subjName ? `Ujian ${subjName}` : 'Hasil Ujian Tersimpan'),
                              targetClass: filterClass,
                              duration: session?.duration || '-',
                              subjectId: session?.subjectId || '',
                              packetName: session?.packetName || '',
                              isDeleted: true
                            }] as [string, any];
                          })
                        ];

                        if (mergedExams.length === 0) {
                          return (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="col-span-full py-16 text-center bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] flex flex-col items-center justify-center p-8"
                            >
                              <div className="w-14 h-14 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
                                <Search className="w-7 h-7" />
                              </div>
                              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest leading-relaxed">
                                Tidak ditemukan jadwal ujian<br/>untuk kelas ini
                              </p>
                            </motion.div>
                          );
                        }

                        return mergedExams.map(([id, ex], exIdx) => (
                            <motion.div
                              key={id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: exIdx * 0.05 }}
                              onClick={() => setFilterExam(id)}
                              className="relative flex flex-col items-start p-5 bg-white border border-slate-200 rounded-[1.5rem] hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-100 transition-all group text-left cursor-pointer"
                            >
                              <div className="w-11 h-11 rounded-2xl bg-slate-50 text-slate-400 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center mb-4 transition-all duration-300 transform group-hover:scale-110 shadow-sm">
                                <FileSpreadsheet className="w-5.5 h-5.5" />
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteExam({ isOpen: true, examId: id });
                                }}
                                className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 z-10"
                                title="Hapus File Soal & Hasil"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <h5 className="text-[11px] font-black text-slate-800 group-hover:text-blue-700 transition-colors uppercase leading-snug line-clamp-2 mb-2 tracking-tight pr-10">
                                {ex.title}
                              </h5>
                              {(() => {
                                const examSessions = deduplicateStudentSessions(allClassSessions.filter(s => s.examId === id));
                                const participantCount = examSessions.length;
                                return (
                                  <div className="flex flex-wrap items-center gap-1.5 mb-4">
                                    <div className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase flex items-center gap-1">
                                      <Clock className="w-2.5 h-2.5" />
                                      <span>{ex.duration} Menit</span>
                                    </div>
                                    <div className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100/40 text-[9px] font-bold uppercase flex items-center gap-1" title="Jumlah peserta mengikuti ujian">
                                      <Users className="w-2.5 h-2.5" />
                                      <span>{participantCount} Siswa</span>
                                    </div>
                                    {ex.isDeleted && (
                                      <div className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100/40 text-[9px] font-bold uppercase flex items-center gap-1">
                                        <span>Arsip Ujian</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <div className="mt-auto pt-3 border-t border-slate-50 w-full flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-[9px] font-extrabold text-blue-500 uppercase tracking-widest">
                                      {subjectsMap[ex.subjectId] || 'Mata Pelajaran'}
                                    </span>
                                    {ex.audioId && (
                                      <div className="flex items-center gap-1 text-[8px] text-amber-600 font-black uppercase tracking-tight bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100/40 w-max">
                                        <Music className="w-2 h-2" />
                                        <span className="truncate max-w-[120px]" title={audioNames[ex.audioId]}>Audio: {audioNames[ex.audioId]}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[8px] font-black uppercase">
                                    <span>Pilih</span>
                                    <Award className="w-2.5 h-2.5 text-blue-400" />
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          ));
                    })()}
                  </div>
                </div>
              </div>
           ) : (
             <div className="flex flex-col h-full min-h-0 bg-white">
               {/* Search Panel */}
               <div id="results-search-toolbar" className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                 <div className="relative w-full sm:max-w-xs">
                   <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                     <Search className="h-4 w-4 text-slate-400" />
                   </div>
                   <input
                     id="candidate-search-input"
                     type="text"
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     placeholder="Cari nama peserta..."
                     className="block w-full pl-9 pr-8 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                   />
                   {searchQuery && (
                     <button
                       onClick={() => setSearchQuery('')}
                       className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                     >
                       <X className="h-3 w-3" />
                     </button>
                   )}
                 </div>
                 
                 <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                   <span>Menampilkan: </span>
                   <span className="text-blue-600 font-extrabold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100/40">{sortedSessions.length}</span>
                   <span>dari</span>
                   <span className="text-slate-705 font-extrabold">{sessions.length}</span>
                   <span>Siswa</span>
                 </div>
               </div>

               <div className="overflow-auto flex-1">
                 <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-b border-slate-100 sticky top-0 z-10">
                  <th className="px-4 py-2 w-10">No</th>
                  <th className="px-4 py-2">Peserta</th>
                  <th className="px-4 py-2">Ujian</th>
                  <th className="px-4 py-2 text-center">Nilai</th>
                  <th className="px-4 py-2 text-center">Benar/Salah</th>
                  <th className="px-4 py-2 text-center">Durasi Kerja</th>
                  <th className="px-4 py-2 text-center">Status</th>
                  <th className="px-4 py-2 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="text-xs divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                      Memuat data...
                    </td>
                  </tr>
                ) : sortedSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500 font-bold">
                      Belum ada hasil ujian untuk filter ini.
                    </td>
                  </tr>
                ) : (
                  sortedSessions.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-800">{s.studentName}</div>
                        <div className="text-[10px] text-slate-500">Kelas {s.className}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-700 leading-snug">{s.examTitle || exams[s.examId]?.title || (subjectsMap[s.subjectId] ? `Ujian ${subjectsMap[s.subjectId]}` : 'Ujian')}</div>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {s.packetName && (
                            <span className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-200/80 px-1.5 py-0.2 rounded uppercase">
                              {s.packetName}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 font-medium">{new Date(s.endTime || 0).toLocaleDateString()}</span>
                        </div>
                        {exams[s.examId]?.audioId && (
                          <div className="flex items-center gap-1 text-[8px] text-amber-600 font-black uppercase tracking-tight bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100/40 w-max mt-0.5">
                            <Music className="w-2 h-2" />
                            <span className="truncate max-w-[100px]" title={audioNames[exams[s.examId]!.audioId!]}>Audio: {audioNames[exams[s.examId]!.audioId!]}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-base font-bold ${s.score! >= 70 ? 'text-green-600' : 'text-red-500'}`}>
                          {s.score?.toFixed(1) || '0'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded mr-1">{s.correctCount || 0}</span>
                        <span className="text-red-500 font-bold bg-red-50 px-1.5 py-0.5 rounded">{s.wrongCount || 0}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-600 font-bold whitespace-nowrap">
                        {getDurationDisplay(s)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${s.status === 'Didiskualifikasi' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center flex items-center justify-center gap-1.5 border-none">
                        <button 
                          onClick={() => handleOpenGradingModal(s)}
                          className="px-2 py-1 rounded text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 flex items-center justify-center gap-1 transition-colors cursor-pointer" 
                          title="Detail & Koreksi"
                        >
                          <Award className="w-3.5 h-3.5" />
                          <span>Detail & Koreksi</span>
                        </button>
                        <button 
                          onClick={() => triggerDelete(s.id!, s.studentName)} 
                          className="px-2 py-1 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 flex items-center justify-center gap-1 transition-colors cursor-pointer" 
                          title="Hapus Hasil"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Hapus</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
               </div>
             </div>
           )}
         </div>
      </div>

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-slate-900 border border-slate-800 text-white font-medium text-xs px-3.5 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>{toast}</span>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmDelete.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-100 p-5 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">
              Hapus Hasil Ujian
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              Apakah Anda yakin ingin menghapus hasil ujian untuk <strong className="text-slate-700">{confirmDelete.studentName}</strong>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-2 w-full">
              <button 
                onClick={() => setConfirmDelete(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={executeDelete} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation for Delete Exam Results */}
      {confirmDeleteExam.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-100 p-5 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">
              Hapus File Soal & Hasil
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              Apakah Anda yakin ingin menghapus <strong>file soal beserta semua hasil ujiannya</strong>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex gap-2 w-full">
              <button 
                onClick={() => setConfirmDeleteExam({ isOpen: false, examId: '' })} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors"
                disabled={loading}
              >
                Batal
              </button>
              <button 
                onClick={executeDeleteExamResults} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                disabled={loading}
              >
                Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Koreksi & Jawaban Siswa Modal */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[9px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider">
                  Koreksi & Detail Jawaban
                </span>
                <h3 className="text-sm font-bold text-slate-800 mt-1 uppercase tracking-wide">
                  {selectedSession.studentName} <span className="text-slate-400 font-normal">({selectedSession.className})</span>
                </h3>
              </div>
              <button 
                onClick={() => setSelectedSession(null)} 
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-slate-50 divide-y divide-slate-100 space-y-4">
              <div className="bg-white rounded-xl p-4 border border-slate-200 flex items-center justify-between shadow-xs shrink-0">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Ujian</p>
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-tight">{selectedSession.examTitle || exams[selectedSession.examId]?.title || (subjectsMap[selectedSession.subjectId] ? `Ujian ${subjectsMap[selectedSession.subjectId]}` : 'Ujian')}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-0.5">Nilai Terkoreksi</p>
                  <span className="text-xl font-black text-blue-600 font-mono">
                    {selectedSession.score?.toFixed(1) || '0'} / 100
                  </span>
                </div>
              </div>

              {loadingQuestions ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                  <p className="text-xs font-bold uppercase">Memuat rincian soal...</p>
                </div>
              ) : sessionQuestions.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs font-bold">
                  Tidak ada data pertanyaan untuk ujian ini.
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  <h4 className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">Review Jawaban per Soal:</h4>
                  {sessionQuestions.map((q, qIndex) => {
                    const isEssay = q.type === 'essay';
                    const weight = q.weight || 10;
                    const studentAns = selectedSession.answers?.[q.id!] || '';
                    
                    let isMC_Correct = false;
                    if (!isEssay) {
                      isMC_Correct = studentAns.toUpperCase().trim() === q.correctAnswer.toUpperCase().trim();
                    }

                    return (
                      <div key={q.id || qIndex} className="bg-white rounded-xl border border-slate-200 p-4 shadow-3xs overflow-hidden">
                        <div className="flex items-start justify-between border-b border-slate-100 pb-2 mb-3">
                          <span className={`text-[10px] uppercase font-extrabold px-2 py-0.5 rounded border ${
                            isEssay ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                            q.type === 'isian_singkat' ? 'bg-amber-100 text-amber-800 border-amber-200' : 
                            q.type === 'listening' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                            q.type === 'pilihan_ganda_kompleks' ? 'bg-teal-50 text-teal-800 border-teal-200' :
                            'bg-slate-50 text-slate-600 border-slate-200'
                          }`}>
                            Soal {qIndex + 1} - {
                              isEssay ? 'Essay / Uraian' : 
                              q.type === 'isian_singkat' ? 'Isian Singkat' : 
                              q.type === 'listening' ? 'Listening' :
                              q.type === 'pilihan_ganda_kompleks' ? 'PG Kompleks' :
                              'Pilihan Ganda'
                            }
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            Bobot: {weight}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-slate-800 mb-3 whitespace-pre-wrap leading-relaxed ql-editor px-0 py-0" dangerouslySetInnerHTML={{ __html: formatHTML(q.question) }} />

                        {q.type === 'isian_singkat' ? (
                          <div className="space-y-2">
                            <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl">
                              <p className="text-[10px] font-extrabold text-slate-500 uppercase">Jawaban Siswa:</p>
                              <p className="text-sm font-bold text-slate-800 mt-1">{studentAns || <em className="text-slate-400 font-normal">Siswa tidak menjawab</em>}</p>
                            </div>
                            <div className="p-3 bg-emerald-50/50 border border-emerald-150 rounded-xl">
                              <p className="text-[10px] font-extrabold text-emerald-700 uppercase">Kunci Isian Singkat:</p>
                              <p className="text-sm font-bold text-emerald-800 mt-0.5">{q.correctAnswer || '-'}</p>
                            </div>
                            <div className="flex items-center gap-2 mt-3 mb-4">
                              {(() => {
                                const smartPoints = calculateSmartPoints(studentAns, q.correctAnswer, weight);
                                const isFull = smartPoints === weight;
                                const isPartial = smartPoints > 0 && !isFull;
                                return isFull ? (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Sistem Pintar: Benar (+{weight} Poin)</span>
                                  </div>
                                ) : isPartial ? (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Sistem Pintar: Sebagian Benar (+{smartPoints} Poin)</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                                    <X className="w-3.5 h-3.5" />
                                    <span>Sistem Pintar: Belum Sesuai (0 Poin)</span>
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Scoring Box for Isian Singkat */}
                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">Koreksi Manual (Maks {weight}):</label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number"
                                  min={0}
                                  max={weight}
                                  step={0.5}
                                  value={editingScores[q.id!] !== undefined ? editingScores[q.id!] : calculateSmartPoints(studentAns, q.correctAnswer, weight)}
                                  onChange={(e) => {
                                    const val = Math.min(weight, Math.max(0, parseFloat(e.target.value) || 0));
                                    setEditingScores(prev => ({ ...prev, [q.id!]: val }));
                                  }}
                                  className="w-16 px-2 py-1 text-xs bg-white border border-slate-300 rounded text-center font-bold text-slate-800 focus:ring-1 focus:ring-amber-500"
                                />
                                <span className="text-[10px] text-slate-500 font-bold">/ {weight}</span>
                              </div>
                              <div className="flex gap-1 ml-auto">
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: weight }))}
                                  className="px-2 py-1 text-[8px] font-black text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Benar Sempurna
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: Math.round(weight / 2) }))}
                                  className="px-2 py-1 text-[8px] font-black text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Setengah
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: 0 }))}
                                  className="px-2 py-1 text-[8px] font-black text-red-800 bg-red-100 hover:bg-red-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Salah
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : q.type === 'pilihan_ganda_kompleks' ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 text-[11px] gap-2 mb-3 bg-slate-50 p-2.5 rounded border border-slate-100">
                              {['A', 'B', 'C', 'D', 'E'].map(l => {
                                const optVal = (q as any)[`option${l}`];
                                if (isOptionEmpty(optVal)) return null;
                                const correctKeys = (q.correctAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                                const studentKeys = studentAns.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                                const isKey = correctKeys.includes(l);
                                const isSt = studentKeys.includes(l);
                                return (
                                  <div key={l} className={`flex items-baseline gap-2 p-1.5 rounded transition-all ${isSt ? (isKey ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800') : (isKey ? 'bg-green-50/40 text-green-700 font-semibold' : '')}`}>
                                    <span className="font-bold select-none text-[11px]">{l}.</span>
                                    <div className="ql-editor p-0 text-[11px] flex-1 [&_p]:m-0 [&_p]:p-0" dangerouslySetInnerHTML={{ __html: formatHTML(optVal) }} />
                                    {isSt && <span className="text-[9px] font-bold uppercase ml-1 self-baseline">(Pilihan Siswa)</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const availCount = ['A', 'B', 'C', 'D', 'E'].filter(l => !isOptionEmpty((q as any)[`option${l}`])).length || 5;
                                const pgk = calculatePgkPoints(studentAns, q.correctAnswer, weight, availCount);

                                return pgk.isFull ? (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Benar Sempurna (+{weight} Poin)</span>
                                  </div>
                                ) : pgk.isPartial ? (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-100">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Sebagian Benar (+{pgk.earned.toFixed(1)} Poin, {pgk.correctChosenCount}/{pgk.totalCorrectCount} Kunci)</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                                    <X className="w-3.5 h-3.5" />
                                    <span>Jawaban Salah (0 Poin)</span>
                                  </div>
                                );
                              })()}
                              <span className="text-[10px] text-slate-400 font-bold uppercase font-mono">Kunci: {q.correctAnswer}</span>
                            </div>

                            {/* Scoring Box for PGK */}
                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <label className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">Koreksi Manual (Maks {weight}):</label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number"
                                  min={0}
                                  max={weight}
                                  step={0.5}
                                  value={editingScores[q.id!] !== undefined ? editingScores[q.id!] : (() => {
                                    const availCount = ['A', 'B', 'C', 'D', 'E'].filter(l => !isOptionEmpty((q as any)[`option${l}`])).length || 5;
                                    const pgk = calculatePgkPoints(studentAns, q.correctAnswer, weight, availCount);
                                    return pgk.earned;
                                  })()}
                                  onChange={(e) => {
                                    const val = Math.min(weight, Math.max(0, parseFloat(e.target.value) || 0));
                                    setEditingScores(prev => ({ ...prev, [q.id!]: val }));
                                  }}
                                  className="w-16 px-2 py-1 text-xs bg-white border border-slate-300 rounded text-center font-bold text-slate-800 focus:ring-1 focus:ring-teal-500"
                                />
                                <span className="text-[10px] text-slate-500 font-bold">/ {weight}</span>
                              </div>
                              <div className="flex gap-1 ml-auto">
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: weight }))}
                                  className="px-2 py-1 text-[8px] font-black text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Benar Sempurna
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: Math.round(weight / 2) }))}
                                  className="px-2 py-1 text-[8px] font-black text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Setengah
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: 0 }))}
                                  className="px-2 py-1 text-[8px] font-black text-red-800 bg-red-100 hover:bg-red-200 rounded-md cursor-pointer uppercase transition-colors"
                                >
                                  Salah
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : !isEssay ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 text-[11px] gap-2 mb-3 bg-slate-50 p-2.5 rounded border border-slate-100">
                              {['A', 'B', 'C', 'D', 'E'].map(l => {
                                const optVal = (q as any)[`option${l}`];
                                if (isOptionEmpty(optVal)) return null;
                                const isKey = q.correctAnswer === l;
                                const isSt = studentAns === l;
                                return (
                                  <div key={l} className={`flex items-baseline gap-2 p-1.5 rounded transition-all ${isSt ? (isKey ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800') : ''}`}>
                                    <span className="font-bold select-none text-[11px]">{l}.</span>
                                    <div className="ql-editor p-0 text-[11px] flex-1 [&_p]:m-0 [&_p]:p-0" dangerouslySetInnerHTML={{ __html: formatHTML(optVal) }} />
                                    {isSt && <span className="text-[9px] font-bold uppercase ml-1 self-baseline">(Pilihan Siswa)</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2">
                              {isMC_Correct ? (
                                <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Jawaban Benar (+{weight} Poin)</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                                  <X className="w-3.5 h-3.5" />
                                  <span>Jawaban Salah (0 Poin)</span>
                                </div>
                              )}
                              <span className="text-[10px] text-slate-400 font-bold uppercase font-mono">Kunci: {q.correctAnswer}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Jawaban Siswa:</span>
                              {studentAns.trim() ? (
                                <blockquote className="bg-purple-50/50 block text-xs border-l-4 border-purple-500 p-3 rounded-r-lg font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                                  {studentAns}
                                </blockquote>
                              ) : (
                                <div className="bg-slate-100 rounded p-3 text-xs italic text-slate-400 font-semibold text-center">
                                  Siswa tidak menjawab pertanyaan ini.
                                </div>
                              )}
                            </div>

                            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                              <span className="block text-[10px] font-bold text-emerald-800 uppercase mb-1">Pedoman Kunci Jawaban:</span>
                              <p className="text-xs font-medium text-emerald-800 leading-relaxed">{q.correctAnswer || '-'}</p>
                            </div>

                            {(() => {
                              const smartPoints = calculateSmartPoints(studentAns, q.correctAnswer, weight);
                              const isFull = smartPoints === weight;
                              const isPartial = smartPoints > 0 && !isFull;
                              return (
                                <div className="flex items-center gap-2 mt-2 mb-1">
                                  {isFull ? (
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Sistem Pintar: Benar / Parafrase Tepat (+{weight} Poin)</span>
                                    </div>
                                  ) : isPartial ? (
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200">
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Sistem Pintar: Sebagian Benar (+{smartPoints} Poin)</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                                      <X className="w-3.5 h-3.5" />
                                      <span>Sistem Pintar: Belum Sesuai (0 Poin)</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Scoring Box */}
                            <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                              <label className="text-[10px] font-bold text-slate-600 uppercase">Input Nilai Koreksi Manual (Maks {weight}):</label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number"
                                  min={0}
                                  max={weight}
                                  step={0.5}
                                  value={editingScores[q.id!] !== undefined ? editingScores[q.id!] : calculateSmartPoints(studentAns, q.correctAnswer, weight)}
                                  onChange={(e) => {
                                    const val = Math.min(weight, Math.max(0, parseFloat(e.target.value) || 0));
                                    setEditingScores(prev => ({ ...prev, [q.id!]: val }));
                                  }}
                                  className="w-20 px-2 py-1 text-xs bg-white border border-slate-300 rounded text-center font-bold text-slate-800 focus:ring-1 focus:ring-purple-500"
                                />
                                <span className="text-[11px] text-slate-500 font-medium font-mono">/ {weight} Poin</span>
                              </div>
                              <div className="flex gap-1 ml-auto">
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: calculateSmartPoints(studentAns, q.correctAnswer, weight) }))}
                                  className="px-2 py-0.5 text-[9px] font-bold text-purple-800 bg-purple-100 hover:bg-purple-200 rounded cursor-pointer uppercase transition-colors"
                                  title="Gunakan nilai rekomendasi sistem pintar"
                                >
                                  Sistem Pintar
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: weight }))}
                                  className="px-2 py-0.5 text-[9px] font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded cursor-pointer uppercase transition-colors"
                                >
                                  Benar Sempurna
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: Math.round(weight / 2) }))}
                                  className="px-2 py-0.5 text-[9px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded cursor-pointer uppercase transition-colors"
                                >
                                  Setengah
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => setEditingScores(prev => ({ ...prev, [q.id!]: 0 }))}
                                  className="px-2 py-0.5 text-[9px] font-bold text-red-800 bg-red-100 hover:bg-red-200 rounded cursor-pointer uppercase transition-colors"
                                >
                                  Salah
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-100 border-t border-slate-200 flex justify-end gap-2 shrink-0">
              <button 
                onClick={() => setSelectedSession(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-200 border border-slate-300 hover:bg-slate-300 rounded-lg transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button 
                disabled={loadingQuestions || savingGrades}
                onClick={handleSaveEssayGrades}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {savingGrades ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Simpan Koreksi & Nilai</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
