import React, { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, setDoc, updateDoc, deleteDoc, doc, orderBy, where, onSnapshot, deleteField } from 'firebase/firestore';
import { Exam, Subject, Class, AudioItem } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Key, Clock, Copy, CheckCircle2, Search, Filter, Music, Shuffle, Layers, AlertCircle, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';

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
    packetNames: [],
    isRandomPacket: false,
    packageDistributionMode: 'round_robin',
    duration: 90,
    isActive: false,
    activeToken: '',
    autoResetInterval: 'manual',
    randomizeQuestions: false,
    showScoreToStudent: false,
    requireStudentPassword: true,
    maxViolations: 3
  });

  const examsRef = useRef<Exam[]>([]);
  useEffect(() => {
    examsRef.current = exams;
  }, [exams]);

  useEffect(() => {
    if (!user) return;
    // Subscribe to exams in real-time
    const qExams = query(collection(db, 'exams'), where('adminId', '==', user.uid));
    const unsubExams = onSnapshot(qExams, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Exam));
      console.log("Exams snapshot updated:", list.length, list);
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setExams(list);
      setLoading(false);
    }, (error) => {
      console.warn("Exams snapshot warning:", error);
      setLoading(false);
    });

    // Subscribe to subjects in real-time
    const qSubjects = query(collection(db, 'subjects'), where('adminId', '==', user.uid));
    const unsubSubjects = onSnapshot(qSubjects, (snapshot) => {
      const subList = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Subject));
      subList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setSubjects(subList);
    }, (error) => {
      console.warn("Subjects snapshot warning:", error);
    });

    // Subscribe to classes in real-time
    const qClasses = query(collection(db, 'classes'), where('adminId', '==', user.uid));
    const unsubClasses = onSnapshot(qClasses, (snapshot) => {
      const classList = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Class));
      classList.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesData(classList);
    }, (error) => {
      console.warn("Classes snapshot warning:", error);
    });

    // Subscribe to audio banks in real-time
    const qAudio = query(collection(db, 'audio_banks'), where('adminId', '==', user.uid));
    const unsubAudio = onSnapshot(qAudio, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as AudioItem));
      setAudioList(list);
    }, (error) => {
      console.warn("Audio snapshot warning:", error);
    });

    return () => {
      unsubExams();
      unsubSubjects();
      unsubClasses();
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

  // Background token auto-reset check
  useEffect(() => {
    const checkAndResetTokens = async () => {
      const currentExams = examsRef.current;
      if (!currentExams || currentExams.length === 0) return;

      let changed = false;
      const newList = [...currentExams];

      for (let i = 0; i < newList.length; i++) {
        const exam = newList[i];
        if (exam.isActive && exam.autoResetInterval && exam.autoResetInterval !== 'manual') {
          const intervalMinutes = parseInt(exam.autoResetInterval, 10);
          if (!isNaN(intervalMinutes)) {
            const lastUpdated = exam.tokenUpdatedAt || 0;
            const elapsedMs = Date.now() - lastUpdated;
            const limitMs = intervalMinutes * 60 * 1000;

            if (elapsedMs >= limitMs) {
              const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
              let newToken = '';
              for (let k = 0; k < 6; k++) {
                newToken += chars.charAt(Math.floor(Math.random() * chars.length));
              }
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

    const interval = setInterval(checkAndResetTokens, 15000);
    return () => clearInterval(interval);
  }, []);

  const fetchPackets = async (subId: string) => {
    if (!user) return;
    try {
      const q = query(collection(db, 'questions'), where('subjectId', '==', subId), where('adminId', '==', user.uid));
      const snap = await getDocs(q);
      const packets = new Set<string>();
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.packetName) packets.add(data.packetName);
      });
      if (packets.size === 0) {
        const allSnap = await getDocs(query(collection(db, 'questions'), where('adminId', '==', user.uid)));
        allSnap.docs.forEach(doc => {
          const data = doc.data();
          if (data.packetName) packets.add(data.packetName);
        });
      }
      setAvailablePackets(Array.from(packets).sort());
    } catch (e) { console.error(e); }
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
    } catch (e) { console.error(e); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const activeAdminId = user?.uid || auth.currentUser?.uid || 'admin_user';

    if (!formData.title || !formData.title.trim()) {
      setErrorMsg("Nama Ujian wajib diisi.");
      return;
    }

    if (!formData.targetClass || !formData.targetClass.trim()) {
      setErrorMsg("Pilih Kelas yang dituju terlebih dahulu.");
      return;
    }

    if (!formData.subjectId) {
      setErrorMsg("Pilih Mata Pelajaran terlebih dahulu.");
      return;
    }

    if (formData.isRandomPacket) {
      const pkts = (formData.packetNames || []).map(p => p.trim()).filter(Boolean);
      if (pkts.length < 2) {
        setErrorMsg("Pilih minimal 2 paket soal untuk mode Multi-Paket Acak (misal: Paket A dan Paket B).");
        return;
      }
    } else {
      if (!formData.packetName || formData.packetName.trim() === '') {
        setErrorMsg("Pilih file paket soal terlebih dahulu.");
        return;
      }
    }

    const activeToken = (formData.activeToken || generateToken()).trim().toUpperCase();

    const cleanAudioId = formData.audioId && formData.audioId.trim() !== '' ? formData.audioId : null;

    const selectedPackets = formData.isRandomPacket
      ? (formData.packetNames || []).map(p => p.trim()).filter(Boolean)
      : (formData.packetName ? [formData.packetName.trim()] : []);

    const currentEditId = editingId;
    const targetExamId = currentEditId || doc(collection(db, 'exams')).id;

    const basePayload: any = {
      title: (formData.title || '').trim(),
      subjectId: formData.subjectId || '',
      targetClass: (formData.targetClass || '').trim(),
      duration: Number(formData.duration) || 90,
      isActive: !!formData.isActive,
      activeToken: activeToken,
      autoResetInterval: formData.autoResetInterval || 'manual',
      randomizeQuestions: !!formData.randomizeQuestions,
      showScoreToStudent: !!formData.showScoreToStudent,
      requireStudentPassword: formData.requireStudentPassword !== false,
      maxViolations: formData.maxViolations !== undefined ? Number(formData.maxViolations) : 3,
      isRandomPacket: !!formData.isRandomPacket,
      packetNames: selectedPackets,
      packetName: formData.isRandomPacket ? (selectedPackets[0] || '') : (formData.packetName || ''),
      packageDistributionMode: formData.packageDistributionMode || 'round_robin',
      tokenUpdatedAt: Date.now(),
      adminId: activeAdminId,
    };

    const firestorePayload: any = { ...basePayload };
    const statePayload: any = { ...basePayload };

    if (cleanAudioId) {
      firestorePayload.audioId = cleanAudioId;
      statePayload.audioId = cleanAudioId;
    } else if (currentEditId) {
      firestorePayload.audioId = deleteField();
      delete statePayload.audioId;
    }

    setProcessing(true);
    try {
      console.log("Saving exam to Firestore:", { id: currentEditId || targetExamId, firestorePayload });
      if (currentEditId) {
        await setDoc(doc(db, 'exams', currentEditId), firestorePayload, { merge: true });
      } else {
        await setDoc(doc(db, 'exams', targetExamId), {
          ...firestorePayload,
          createdAt: Date.now()
        });
      }
      console.log("Save successful");
      setIsAdding(false);
      setEditingId(null);
      resetForm();
    } catch (err: any) {
      console.error("Error saving exam schedule:", err);
      setErrorMsg(err?.message ? `Gagal menyimpan: ${err.message}` : "Terjadi kesalahan saat menyimpan jadwal ujian.");
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = (id: string) => {
    setModalConfig({
      title: 'Hapus Jadwal Ujian',
      description: 'Apakah Anda yakin ingin menghapus jadwal ujian ini dari Manajemen Ujian? Data nilai dan hasil pengerjaan siswa akan tetap tersimpan aman di menu Hasil Ujian.',
      idToDelete: id
    });
  };

  const executeDelete = async () => {
    if (!modalConfig || !modalConfig.idToDelete) return;
    const targetId = modalConfig.idToDelete;

    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'exams', targetId));
      setModalConfig(null);
    } catch (err: any) {
      console.error("Error deleting exam:", err);
      setErrorMsg(err?.message ? `Gagal menghapus: ${err.message}` : "Terjadi kesalahan saat menghapus jadwal ujian.");
    } finally {
      setProcessing(false);
    }
  };

  const startEdit = (exam: Exam) => {
    setErrorMsg(null);
    setEditingId(exam.id!);
    const hasMulti = !!exam.isRandomPacket || (Array.isArray(exam.packetNames) && exam.packetNames.length > 1);
    setFormData({
      ...exam,
      isRandomPacket: hasMulti,
      packetNames: exam.packetNames || (exam.packetName ? [exam.packetName] : []),
      packageDistributionMode: exam.packageDistributionMode || 'round_robin',
      requireStudentPassword: exam.requireStudentPassword !== false
    });
    setIsAdding(true);
  };

  const resetForm = () => {
    setErrorMsg(null);
    setFormData({
      title: '',
      subjectId: '',
      packetName: '',
      packetNames: [],
      isRandomPacket: false,
      packageDistributionMode: 'round_robin',
      duration: 90,
      isActive: false,
      activeToken: generateToken(),
      autoResetInterval: 'manual',
      targetClass: '',
      randomizeQuestions: false,
      showScoreToStudent: false,
      requireStudentPassword: true,
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
      (exam.packetName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (exam.packetNames || []).some(p => p.toLowerCase().includes(searchQuery.toLowerCase()));
    
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
            <motion.form 
              onSubmit={handleSave}
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
              
                <div className="space-y-4">
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
                      {/* Package Configuration */}
                      <div className="p-3 bg-slate-50/90 rounded-lg border border-slate-200 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <label className="text-xs font-bold text-slate-700 uppercase flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-600" />
                            Konfigurasi Paket Soal *
                          </label>
                          <div className="flex bg-slate-200/80 p-0.5 rounded-md text-[10px] font-bold">
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, isRandomPacket: false })}
                              className={`px-2 py-1 rounded transition-all cursor-pointer ${!formData.isRandomPacket ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                            >
                              Paket Tunggal
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const currentP = formData.packetNames && formData.packetNames.length > 0 
                                  ? formData.packetNames 
                                  : (formData.packetName ? [formData.packetName] : (availablePackets.slice(0, 3)));
                                setFormData({ 
                                  ...formData, 
                                  isRandomPacket: true,
                                  packetNames: currentP
                                });
                              }}
                              className={`px-2 py-1 rounded transition-all flex items-center gap-1 cursor-pointer ${formData.isRandomPacket ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                            >
                              <Shuffle className="w-2.5 h-2.5" />
                              Multi-Paket Acak (A, B, C)
                            </button>
                          </div>
                        </div>

                        {!formData.isRandomPacket ? (
                          /* Mode Paket Tunggal */
                          <div>
                            {(() => {
                              const packetOptions = Array.from(new Set([
                                ...(formData.packetName ? [formData.packetName] : []),
                                ...availablePackets
                              ])).filter(Boolean).sort();
                              return (
                                <div className="space-y-1.5">
                                  {packetOptions.length > 0 ? (
                                    <select
                                      required={!formData.isRandomPacket}
                                      value={formData.packetName || ''}
                                      onChange={e => setFormData({...formData, packetName: e.target.value})}
                                      className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 appearance-none font-medium"
                                    >
                                      <option value="">-- Pilih Paket File Soal --</option>
                                      {packetOptions.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      required={!formData.isRandomPacket}
                                      value={formData.packetName || ''}
                                      onChange={e => setFormData({...formData, packetName: e.target.value})}
                                      placeholder="Ketik Nama Paket Soal (misal: Paket A)..."
                                      className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 font-medium"
                                    />
                                  )}
                                  {formData.subjectId && packetOptions.length === 0 && (
                                    <p className="text-[10px] text-amber-600 font-semibold italic">
                                      * Ketik nama paket soal yang ingin digunakan jika belum mengunggah soal di Bank Soal.
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          /* Mode Multi-Paket Acak (A, B, C) */
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-600">
                                Pilih Paket Soal yang Dibagikan ke Siswa:
                              </span>
                              {availablePackets.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFormData({
                                      ...formData,
                                      packetNames: [...availablePackets]
                                    });
                                  }}
                                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                                >
                                  Pilih Semua ({availablePackets.length})
                                </button>
                              )}
                            </div>

                            {/* Available packet chips / checkboxes */}
                            {availablePackets.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 bg-white border border-slate-200 rounded-md">
                                {availablePackets.map(pkt => {
                                  const isSelected = (formData.packetNames || []).includes(pkt);
                                  return (
                                    <button
                                      key={pkt}
                                      type="button"
                                      onClick={() => {
                                        const current = formData.packetNames || [];
                                        const next = isSelected 
                                          ? current.filter(p => p !== pkt)
                                          : [...current, pkt];
                                        setFormData({ ...formData, packetNames: next });
                                      }}
                                      className={`px-2 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                                        isSelected 
                                          ? 'bg-indigo-50 border-indigo-400 text-indigo-700 shadow-3xs' 
                                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[9px] ${isSelected ? 'bg-indigo-600 text-white' : 'border border-slate-300'}`}>
                                        {isSelected && <Check className="w-2.5 h-2.5" />}
                                      </span>
                                      <span>{pkt}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 flex items-start gap-1.5">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                  <p className="font-bold">Belum ada paket soal di Bank Soal untuk mata pelajaran ini.</p>
                                  <p className="text-[10px] text-amber-700 mt-0.5">Silakan buat atau unggah file soal dengan nama paket (misal: "Paket A", "Paket B", "Paket C") di menu Bank Soal terlebih dahulu.</p>
                                </div>
                              </div>
                            )}

                            {/* Selected Packets Summary Pills */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase">
                                  Paket Terpilih ({formData.packetNames?.length || 0}):
                                </span>
                                {(formData.packetNames?.length || 0) < 2 && (
                                  <span className="text-[10px] font-bold text-red-500">
                                    * Minimal pilih 2 paket untuk mode acak
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1 min-h-[30px] p-1.5 bg-white border border-slate-200 rounded">
                                {(!formData.packetNames || formData.packetNames.length === 0) ? (
                                  <span className="text-[11px] text-slate-400 italic">Belum ada paket yang dipilih</span>
                                ) : (
                                  formData.packetNames.map(pkt => (
                                    <span
                                      key={pkt}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200"
                                    >
                                      <span>{pkt}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setFormData({
                                            ...formData,
                                            packetNames: (formData.packetNames || []).filter(p => p !== pkt)
                                          });
                                        }}
                                        className="text-indigo-400 hover:text-indigo-700 ml-0.5 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>

                            {/* Distribution Strategy Mode */}
                            <div className="pt-2 border-t border-slate-200">
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                                Metode Distribusi Paket ke Siswa di Kelas:
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label
                                  className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex items-start gap-2 ${
                                    formData.packageDistributionMode !== 'random'
                                      ? 'bg-indigo-50/70 border-indigo-400 text-indigo-900 ring-1 ring-indigo-300'
                                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="distMode"
                                    className="mt-0.5 sr-only"
                                    checked={formData.packageDistributionMode !== 'random'}
                                    onChange={() => setFormData({ ...formData, packageDistributionMode: 'round_robin' })}
                                  />
                                  <div className="flex-1">
                                    <div className="text-xs font-bold flex items-center justify-between">
                                      <span>Round-Robin (Seimbang)</span>
                                      <span className="text-[8px] bg-indigo-200 text-indigo-800 px-1 py-0.2 rounded font-extrabold uppercase">Disarankan</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                                      Dibagi rata bergiliran (A &rarr; B &rarr; C &rarr; A). Siswa berdampingan/login bersamaan dijamin mendapat paket berbeda.
                                    </p>
                                  </div>
                                </label>

                                <label
                                  className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex items-start gap-2 ${
                                    formData.packageDistributionMode === 'random'
                                      ? 'bg-indigo-50/70 border-indigo-400 text-indigo-900 ring-1 ring-indigo-300'
                                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="distMode"
                                    className="mt-0.5 sr-only"
                                    checked={formData.packageDistributionMode === 'random'}
                                    onChange={() => setFormData({ ...formData, packageDistributionMode: 'random' })}
                                  />
                                  <div className="flex-1">
                                    <div className="text-xs font-bold">Acak Murni (Random)</div>
                                    <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                                      Sistem mengundi paket secara acak independen untuk setiap siswa yang baru memulai ujian.
                                    </p>
                                  </div>
                                </label>
                              </div>
                            </div>

                            <div className="p-2 bg-indigo-50/50 border border-indigo-100 rounded text-[10px] text-indigo-700 leading-tight">
                              🔒 <strong>Keamanan:</strong> Paket yang didapat siswa akan langsung terkunci permanen ke akun mereka. Jika HP mati atau koneksi terputus, siswa tetap mengerjakan paket yang sama.
                            </div>
                          </div>
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
                      <div className="grid grid-cols-1 gap-3">
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

                        <div className="flex items-center space-x-2">
                          <label className="relative inline-flex items-center cursor-pointer font-sans select-none">
                            <input type="checkbox" className="sr-only peer" checked={formData.requireStudentPassword !== false} onChange={e => setFormData({...formData, requireStudentPassword: e.target.checked})} />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                            <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Wajibkan Password / PIN Siswa</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-end space-x-2 px-5 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
                <button 
                  type="button" onClick={() => setIsAdding(false)}
                  className="px-4 py-1.5 border border-slate-300 text-slate-700 text-xs font-bold uppercase rounded hover:bg-slate-50 transition-colors bg-white shadow-xs"
                >
                  Batal
                </button>
                <button 
                  type="submit" disabled={processing}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase rounded flex items-center justify-center space-x-1 transition-colors disabled:opacity-50 shadow-xs cursor-pointer"
                >
                  {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  <span>Simpan</span>
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0">
        {errorMsg && !isAdding && (
          <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-xs font-semibold flex items-center justify-between">
            <span>{errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
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
                <th className="px-4 py-3">Durasi</th>
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
                      {exam.isRandomPacket && exam.packetNames && exam.packetNames.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-lg shadow-3xs">
                              <Shuffle className="w-3 h-3 text-indigo-500" />
                              Multi-Paket ({exam.packetNames.length})
                            </span>
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase">
                              {exam.packageDistributionMode === 'random' ? 'Acak' : 'Round-Robin'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {exam.packetNames.map(p => (
                              <span key={p} className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 rounded">
                                {p}
                              </span>
                            ))}
                          </div>
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
                      ) : exam.packetName ? (
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
                      <div className="flex items-center text-slate-500 font-semibold uppercase tracking-wider">
                        <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400 shrink-0" />
                        {exam.duration} Menit
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
