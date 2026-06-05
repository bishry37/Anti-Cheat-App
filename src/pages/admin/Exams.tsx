import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, where, onSnapshot } from 'firebase/firestore';
import { Exam, Subject, Class } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Key, Calendar, Clock, Copy, CheckCircle2 } from 'lucide-react';
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
    randomizeQuestions: false
  });

  useEffect(() => {
    if (!user) return;
    fetchData();

    // Subscribe to exams in real-time
    const q = query(collection(db, 'exams'), where('adminId', '==', user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Exam));
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setExams(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'exams');
    });

    return unsub;
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
    if (exams.length === 0) return;

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
        setExams(newList);
      }
    };

    checkAndResetTokens();
    const interval = setInterval(checkAndResetTokens, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [exams]);

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
      subList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSubjects(subList);

      const classQ = query(collection(db, 'classes'), where('adminId', '==', user.uid));
      const classSnap = await getDocs(classQ);
      const classList = classSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Class));
      classList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
      randomizeQuestions: false
    });
  };

  const getSubjectName = (subId: string) => (Array.isArray(subjects) ? subjects.find(s => s.id === subId) : undefined)?.name || 'Unknown';

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

  return (
    <div className="w-full h-full flex flex-col">
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-5 bg-white p-5 rounded-lg border border-slate-200 shadow-sm shrink-0"
          >
            <h3 className="text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100 uppercase tracking-wider">
              {editingId ? 'Edit Jadwal Ujian' : 'Buat Jadwal Ujian Baru'}
            </h3>
            
            {errorMsg && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-xs font-semibold flex items-center justify-between">
                <span>{errorMsg}</span>
                <button type="button" onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            
            <form onSubmit={handleSave} className="space-y-4">
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

                  <div className="flex flex-col space-y-3 pt-2">
                    <div className="flex items-center space-x-2">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Status Aktif (Siswa)</span>
                      </label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={formData.randomizeQuestions || false} onChange={e => setFormData({...formData, randomizeQuestions: e.target.checked})} />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                        <span className="ml-2 text-xs font-bold text-slate-700 uppercase">Acak Urutan Soal</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-100">
                <button 
                  type="button" onClick={() => setIsAdding(false)}
                  className="px-4 py-1.5 border border-slate-300 text-slate-700 text-xs font-bold uppercase rounded hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button 
                  type="submit" disabled={processing}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase rounded flex items-center justify-center space-x-1 transition-colors disabled:opacity-50"
                >
                  {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  <span>Simpan</span>
                </button>
              </div>
            </form>
          </motion.div>
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
        <div className="overflow-auto flex-1">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-[11px] uppercase font-bold tracking-wider border-b border-slate-100 sticky top-0 z-10">
                <th className="px-4 py-3">Ujian</th>
                <th className="px-4 py-3">Kelas</th>
                <th className="px-4 py-3">Mata Pelajaran</th>
                <th className="px-4 py-3">File Soal</th>
                <th className="px-4 py-3">Urutan Soal</th>
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
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-500 font-bold">
                    Belum ada ujian yang dibuat.
                  </td>
                </tr>
              ) : (
                exams.map((exam) => (
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
                        <span className="inline-block text-xs font-bold text-blue-600 bg-blue-50/80 border border-blue-100/80 px-2.5 py-1 rounded-lg">
                          {exam.packetName}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {exam.randomizeQuestions ? (
                        <span className="inline-flex items-center text-[10px] font-black text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                          Acak Soal
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md uppercase tracking-wider">
                          Berurutan
                        </span>
                      )}
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
