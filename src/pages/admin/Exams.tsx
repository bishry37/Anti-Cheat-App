import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, where, onSnapshot } from 'firebase/firestore';
import { Exam, Subject, Class, AudioItem } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Key, Calendar, Clock, Copy, CheckCircle2, Search, Filter, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';

const formatIndonesianDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${day} ${months[monthIdx]} ${year}`;
  }
  return dateStr;
};

export default function Exams() {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classesData, setClassesData] = useState<Class[]>([]);
  const [audioList, setAudioList] = useState<AudioItem[]>([]);
  const [availablePackets, setAvailablePackets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    description: string;
    idToDelete: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [filterClass, setFilterClass] = useState('');
  const [filterSubject, setFilterSubject] = useState('');

  // Form State
  const [formData, setFormData] = useState<Partial<Exam>>({
    title: '',
    subjectId: '',
    packetName: '',
    duration: 90,
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '08:00',
    endTime: '10:00',
    isActive: false,
    activeToken: '',
    autoResetInterval: 'manual',
    randomizeQuestions: false,
    showScoreToStudent: false,
    maxViolations: 3
  });

  useEffect(() => {
    if (!user) return;
    fetchData();

    // Subscribe to exams in real-time
    const q = query(collection(db, 'exams'), where('adminId', '==', user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Exam));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setExams(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'exams');
    });

    const qAudio = query(collection(db, 'audio_banks'), where('adminId', '==', user.uid));
    const unsubAudio = onSnapshot(qAudio, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as AudioItem));
      setAudioList(list);
    });

    return () => {
      unsub();
      unsubAudio();
    };
  }, [user]);

  useEffect(() => {
    if (formData.subjectId) {
      fetchPackets(formData.subjectId);
    } else {
      setAvailablePackets([]);
    }
  }, [formData.subjectId]);

  // Automatically recalculate exam duration based on Start and End times
  useEffect(() => {
    if (formData.startTime && formData.endTime) {
      const [startH, startM] = formData.startTime.split(':').map(Number);
      const [endH, endM] = formData.endTime.split(':').map(Number);
      if (!isNaN(startH) && !isNaN(startM) && !isNaN(endH) && !isNaN(endM)) {
        let startMin = startH * 60 + startM;
        let endMin = endH * 60 + endM;
        if (endMin < startMin) {
          endMin += 24 * 60; // handle cross-midnight duration gracefully
        }
        const calculatedDiff = endMin - startMin;
        if (calculatedDiff >= 0 && formData.duration !== calculatedDiff) {
          setFormData(prev => ({ ...prev, duration: calculatedDiff }));
        }
      }
    }
  }, [formData.startTime, formData.endTime]);

  // Background token auto-reset check
  useEffect(() => {
    if (!user || exams.length === 0) return;

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
        isUnique = !exams.some(e => e.isActive && e.activeToken === t);
        attempts++;
      }
      return t;
    };

    const checkAndResetTokens = async () => {
      let changed = false;
      const newList = [...exams];

      for (let i = 0; i < newList.length; i++) {
        const exam = newList[i];
        if (exam.adminId === user.uid && exam.isActive && exam.autoResetInterval && exam.autoResetInterval !== 'manual') {
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
        setExams(newList);
      }
    };

    checkAndResetTokens();
    const interval = setInterval(checkAndResetTokens, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [exams, user]);

  const fetchPackets = async (subId: string) => {
    if (!user) return;
    try {
      const q = query(collection(db, 'questions'), where('adminId', '==', user.uid), where('subjectId', '==', subId));
      const snap = await getDocs(q);
      const packets = new Set<string>();
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.packetName) packets.add(data.packetName);
      });
      setAvailablePackets(Array.from(packets).sort());
    } catch (e) { console.error(e); }
  };

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const subQ = query(collection(db, 'subjects'), where('adminId', '==', user.uid));
      const subSnap = await getDocs(subQ);
      const subList = subSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Subject));
      subList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setSubjects(subList);

      const classQ = query(collection(db, 'classes'), where('adminId', '==', user.uid));
      const classSnap = await getDocs(classQ);
      const classList = classSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Class));
      classList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesData(classList);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const generateToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      token = '';
      for (let i = 0; i < 6; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      isUnique = !exams.some(e => e.isActive && e.activeToken === token);
      attempts++;
    }
    return token;
  };

  const handleCreateToken = () => {
    setFormData(prev => ({ ...prev, activeToken: generateToken() }));
  };

  const activeTokenNow = async (id: string) => {
    try {
      await updateDoc(doc(db, 'exams', id), {
        activeToken: generateToken(),
        tokenUpdatedAt: Date.now()
      });
      fetchData();
    } catch (e) { console.error(e); }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.subjectId || !formData.activeToken || !user) {
      setErrorMsg("Lengkapi data exam, termasuk token aktif.");
      return;
    }
    setProcessing(true);
    setErrorMsg(null);
    try {
      const payload = {
        ...formData,
        duration: Number(formData.duration),
        tokenUpdatedAt: Date.now(),
        adminId: user.uid
      };

      if (editingId) {
        await updateDoc(doc(db, 'exams', editingId), payload);
      } else {
        await addDoc(collection(db, 'exams'), {
          ...payload,
          createdAt: Date.now()
        });
      }
      setIsAdding(false);
      setEditingId(null);
      await fetchData();
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'exams');
    }
    setProcessing(false);
  };

  const handleDelete = (id: string) => {
    setModalConfig({
      title: 'Hapus Jadwal Ujian',
      description: 'Apakah Anda yakin ingin menghapus jadwal ujian ini? Data nilai siswa yang berhubungan dengan ujian ini mungkin tidak dapat diakses lagi.',
      idToDelete: id
    });
  };

  const executeDelete = async () => {
    if (!modalConfig || !modalConfig.idToDelete) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'exams', modalConfig.idToDelete));
      setModalConfig(null);
      await fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'exams');
    }
    setProcessing(false);
  };

  const startEdit = (exam: Exam) => {
    setErrorMsg(null);
    setEditingId(exam.id!);
    setFormData(exam);
    setIsAdding(true);
  };

  const resetForm = () => {
    setErrorMsg(null);
    setFormData({
      title: '',
      subjectId: '',
      packetName: '',
      duration: 90,
      date: format(new Date(), 'yyyy-MM-dd'),
      startTime: '08:00',
      endTime: '10:00',
      isActive: false,
      activeToken: generateToken(),
      autoResetInterval: 'manual',
      targetClass: '',
      randomizeQuestions: false,
      showScoreToStudent: false,
      maxViolations: 3
    });
  };

  const getSubjectName = (subId: string) => (Array.isArray(subjects) ? subjects.find(s => s.id === subId) : undefined)?.name || 'Unknown';

  const getAudioName = (audioId: string) => (Array.isArray(audioList) ? audioList.find(a => a.id === audioId) : undefined)?.name || 'Unknown Audio';

  const handleCopyLink = (examId: string) => {
    const shortCode = examId.substring(0, 6);
    const link = `${window.location.origin}/?c=${shortCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(examId);
      setTimeout(() => setCopiedLink(null), 2000);
    }).catch(err => {
      console.error('Failed to copy link', err);
    });
  };

  const filteredExams = exams.filter(exam => {
    const matchesSearch = exam.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (exam.packetName || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterStatus === 'all' ? true :
      filterStatus === 'active' ? exam.isActive : !exam.isActive;
      
    const matchesClass = !filterClass ? true : exam.targetClass === filterClass;
    
    const matchesSubject = !filterSubject ? true : exam.subjectId === filterSubject;
    
    return matchesSearch && matchesStatus && matchesClass && matchesSubject;
  });

  return (
    <div className="w-full h-full flex flex-col">
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 transition-all duration-200">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                  {editingId ? 'Edit Jadwal Ujian' : 'Buat Jadwal Ujian Baru'}
                </h3>
                <button 
                  type="button" 
                  onClick={() => setIsAdding(false)} 
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            
              <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
                {errorMsg && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-xs font-semibold flex items-center justify-between">
                    <span>{errorMsg}</span>
                    <button type="button" onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              
                <form id="exam-form" onSubmit={handleSave} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Nama Ujian *</label>
                        <input 
                          type="text" 
                          required
                          value={formData.title}
                          onChange={e => setFormData({...formData, title: e.target.value})}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                          placeholder="Contoh: Ujian Akhir Semester"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Kelas *</label>
                        <select
                          required
                          value={formData.targetClass || ''}
                          onChange={e => setFormData({...formData, targetClass: e.target.value})}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 appearance-none"
                        >
                          <option value="">-- Pilih Kelas --</option>
                          {classesData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Mata Pelajaran *</label>
                        <select
                          required
                          value={formData.subjectId}
                          onChange={e => setFormData({...formData, subjectId: e.target.value, packetName: ''})}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 appearance-none"
                        >
                          <option value="">-- Pilih Mata Pelajaran --</option>
                          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Pilih File Soal *</label>
                        <select
                          required
                          value={formData.packetName}
                          onChange={e => setFormData({...formData, packetName: e.target.value})}
                          disabled={!formData.subjectId}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 appearance-none disabled:opacity-50"
                        >
                          <option value="">-- {formData.subjectId ? (availablePackets.length > 0 ? 'Pilih File' : 'Belum ada file soal') : 'Pilih Mapel Terlebih Dahulu'} --</option>
                          {availablePackets.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        {formData.subjectId && availablePackets.length === 0 && (
                           <p className="text-[10px] text-red-500 font-bold mt-1 uppercase">* Upload soal di Bank Soal terlebih dahulu</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Audio Listening (Opsional)</label>
                        <select
                          value={formData.audioId || ''}
                          onChange={e => setFormData({...formData, audioId: e.target.value || undefined})}
                          className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 appearance-none"
                        >
                          <option value="">-- Tanpa Audio Listening --</option>
                          {audioList.map(audio => (
                            <option key={audio.id} value={audio.id}>
                              {audio.name} ({Math.floor(audio.duration / 60)}:{(Math.floor(audio.duration % 60) < 10 ? '0' : '') + Math.floor(audio.duration % 60)})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                         <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Tanggal *</label>
                          <input 
                            type="date" required
                            value={formData.date}
                            onChange={e => setFormData({...formData, date: e.target.value})}
                            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Durasi (Menit) *</label>
                          <input 
                            type="number" required min={5}
                            value={formData.duration}
                            onChange={e => setFormData({...formData, duration: Number(e.target.value)})}
                            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                         <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Jam Mulai *</label>
                          <input 
                            type="time" required
                            value={formData.startTime}
                            onChange={e => setFormData({...formData, startTime: e.target.value})}
                            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Jam Selesai *</label>
                          <input 
                            type="time" required
                            value={formData.endTime}
                            onChange={e => setFormData({...formData, endTime: e.target.value})}
                            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div className="p-3 bg-slate-50 rounded border border-slate-200">
                        <h4 className="text-[11px] font-bold text-slate-800 mb-2 uppercase flex items-center"><Key className="w-3 h-3 mr-1 text-slate-500" /> Pengaturan Token</h4>
                        <div className="grid grid-cols-2 gap-3 mb-2">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Token Aktif</label>
                            <div className="flex">
                               <input 
                                type="text" required readOnly
                                value={formData.activeToken}
                                className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-l font-mono font-bold tracking-widest outline-none"
                              />
                              <button type="button" onClick={handleCreateToken} className="bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded-r border border-l-0 border-slate-300 transition-colors">
                                <Key className="w-3 h-3 text-slate-600" />
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Reset Otomatis</label>
                            <select
                              value={formData.autoResetInterval}
                              onChange={e => setFormData({...formData, autoResetInterval: e.target.value as any})}
                              className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="manual">Manual</option>
                              <option value="5">5 Menit</option>
                              <option value="10">10 Menit</option>
                              <option value="15">15 Menit</option>
                              <option value="30">30 Menit</option>
                              <option value="60">60 Menit</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100/50 mt-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Batas Maksimal Pelanggaran *</label>
                        <div className="flex items-center space-x-3">
                          <input 
                            type="number" required min={0}
                            value={formData.maxViolations !== undefined ? formData.maxViolations : 3}
                            onChange={e => setFormData({...formData, maxViolations: Number(e.target.value)})}
                            className="w-20 px-2 py-1 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 text-center font-bold"
                          />
                          <span className="text-[10px] text-slate-500 font-semibold leading-tight">Ujian dihentikan otomatis bila batas tercapai (gunakan 0 untuk tanpa batas)</span>
                        </div>
                      </div>

                      <div className="flex flex-col space-y-3 pt-2">
                        <div className="flex items-center space-x-2">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Status Aktif (Siswa)</span>
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <label className="relative inline-flex items-center cursor-pointer font-sans select-none">
                            <input type="checkbox" className="sr-only peer" checked={formData.randomizeQuestions || false} onChange={e => setFormData({...formData, randomizeQuestions: e.target.checked})} />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                            <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Acak Urutan Soal</span>
                          </label>
                        </div>

                        <div className="flex items-center space-x-2">
                          <label className="relative inline-flex items-center cursor-pointer font-sans select-none">
                            <input type="checkbox" className="sr-only peer" checked={formData.showScoreToStudent || false} onChange={e => setFormData({...formData, showScoreToStudent: e.target.checked})} />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                            <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Izinkan Siswa Melihat Skor Akhir</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
              
              <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
                <button 
                  type="button" onClick={() => setIsAdding(false)}
                  className="px-4 py-1.5 border border-slate-300 text-slate-700 text-xs font-bold uppercase rounded hover:bg-slate-50 transition-colors bg-white shadow-xs"
                >
                  Batal
                </button>
                <button 
                  type="submit" form="exam-form" disabled={processing}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase rounded flex items-center justify-center space-x-1 transition-colors disabled:opacity-50 shadow-xs"
                >
                  {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  <span>Simpan</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Manajemen Ujian</h3>
          {!isAdding && (
            <button 
              onClick={() => { resetForm(); setIsAdding(true); }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-[10px] font-bold flex items-center space-x-1.5 uppercase transition-colors shadow-sm"
            >
              <Plus className="w-3 h-3" />
              <span>Buat Baru</span>
            </button>
          )}
        </div>

        {/* Filter & Search Bar */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200/60 flex flex-wrap gap-2.5 items-center justify-between shrink-0">
          <div className="flex flex-wrap gap-2.5 items-center flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                placeholder="Cari nama ujian atau file soal..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400 font-medium text-slate-800"
              />
            </div>

            <div className="flex items-center space-x-1">
              <Filter className="w-3 h-3 text-slate-400" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer font-medium text-slate-600 bg-[image:none] pr-2.5"
              >
                <option value="all">Semua Status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>

            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer font-medium text-slate-600 bg-[image:none] pr-2.5"
            >
              <option value="">Semua Kelas</option>
              {classesData.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>

            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer font-medium text-slate-600 bg-[image:none] pr-2.5"
            >
              <option value="">Semua Mapel</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {(searchQuery || filterStatus !== 'all' || filterClass || filterSubject) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setFilterStatus('all');
                setFilterClass('');
                setFilterSubject('');
              }}
              className="text-[10px] font-bold uppercase tracking-wider text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded transition-all border border-red-200 cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-[11px] uppercase font-bold tracking-wider border-b border-slate-100 sticky top-0 z-10">
                <th className="px-4 py-3">Ujian</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Mata Pelajaran</th>
                <th className="px-4 py-3">File Soal</th>
                <th className="px-4 py-3">Konfigurasi</th>
                <th className="px-4 py-3">Jadwal</th>
                <th className="px-4 py-3">Token</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Memuat data...
                  </td>
                </tr>
              ) : exams.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                    Belum ada ujian yang dibuat.
                  </td>
                </tr>
              ) : filteredExams.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    Tidak ada ujian yang cocok dengan pencarian / filter.
                  </td>
                </tr>
              ) : (
                filteredExams.map((exam) => (
                  <tr key={exam.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-4 py-4">
                      <div className="text-sm font-semibold text-slate-800 leading-snug">
                        {exam.title}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {exam.targetClass ? (
                        <span className="inline-block text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200/80 px-2.5 py-1 rounded-lg uppercase tracking-wide">
                          {exam.targetClass}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-xs font-semibold text-slate-700">
                      {getSubjectName(exam.subjectId)}
                    </td>
                    <td className="px-4 py-4">
                      {exam.packetName ? (
                        <div className="flex flex-col gap-1.5">
                          <span className="inline-block w-max text-xs font-bold text-blue-600 bg-blue-50/80 border border-blue-100/80 px-2.5 py-1 rounded-lg">
                            {exam.packetName}
                          </span>
                          {exam.audioId && (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-tight">
                              <div className="w-4 h-4 rounded bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
                                <Music className="w-2.5 h-2.5" />
                              </div>
                              <span className="truncate max-w-[120px]" title={getAudioName(exam.audioId)}>
                                Audio: {getAudioName(exam.audioId)}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        {exam.randomizeQuestions ? (
                          <span className="inline-flex items-center w-max text-[9px] font-black text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded uppercase tracking-wider">
                            Acak Soal
                          </span>
                        ) : (
                          <span className="inline-flex items-center w-max text-[9px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded uppercase tracking-wider">
                            Berurutan
                          </span>
                        )}
                        {exam.showScoreToStudent ? (
                          <span className="inline-flex items-center w-max text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded uppercase tracking-wider" title="Siswa dapat melihat skor akhir setelah kirim">
                            Skor Terbuka
                          </span>
                        ) : (
                          <span className="inline-flex items-center w-max text-[9px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded uppercase tracking-wider" title="Skor disembunyikan dari siswa">
                            Skor Ditutup
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600 font-medium">
                      <div className="flex items-center mb-1 text-slate-700 font-semibold">
                        <Calendar className="w-3.5 h-3.5 mr-1.5 text-slate-400 shrink-0" />
                        {formatIndonesianDate(exam.date || '')}
                      </div>
                      <div className="flex items-center text-slate-500 font-semibold">
                        <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400 shrink-0" />
                        {exam.startTime} - {exam.endTime} ({exam.duration}m)
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg text-xs font-bold tracking-widest border border-blue-100 shadow-3xs">
                          {exam.activeToken}
                        </span>
                        <button 
                          onClick={() => activeTokenNow(exam.id!)} 
                          className="p-1.5 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-800 transition-colors bg-white shadow-3xs" 
                          title="Refresh Token"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold mt-1.5 uppercase tracking-wider">
                        Reset: {exam.autoResetInterval === 'manual' ? 'Manual' : `${exam.autoResetInterval}m`}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold uppercase border transition-all ${exam.isActive ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {exam.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end space-x-1.5">
                        <button 
                          onClick={() => startEdit(exam)} 
                          className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg bg-white border border-slate-200 shadow-3xs transition-all" 
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDelete(exam.id!)} 
                          className="p-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg bg-white border border-slate-200 shadow-3xs transition-all" 
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalConfig && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 transition-all duration-200">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-sm w-full overflow-hidden transform scale-100 transition-all duration-150">
            <div className="p-5">
              <h3 className="text-base font-bold text-red-600 mb-2">
                {modalConfig.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mb-4 font-normal">
                {modalConfig.description}
              </p>
            </div>

            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setModalConfig(null)}
                className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 rounded text-xs font-semibold cursor-pointer transition shadow-xs"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executeDelete}
                disabled={processing}
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold uppercase transition shadow-xs cursor-pointer flex items-center space-x-1"
              >
                {processing && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                <span>Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
