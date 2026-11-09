import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, where, writeBatch, onSnapshot } from 'firebase/firestore';
import { Class, StudentRecord, Setting } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Users, Search, ArrowRight, GraduationCap, Check, Key, Copy, Printer, RefreshCw, FileText, LayoutGrid, List, Scissors, Building2, UserCircle, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { getStudentName, getStudentPin, getStudentPhoto, generateDefaultPin, generateRandomPin, normalizeStudentRecord, parseStudentInput } from '../../utils/studentUtils';
import brandLogo from '../../assets/images/logo1.png';

export default function Classes() {
  const { user } = useAuth();
  const [classesList, setClassesList] = useState<Class[]>([]);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    description: string;
    idToDelete?: string | null;
    confirmText?: string;
    onConfirm?: () => Promise<void> | void;
  } | null>(null);

  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [searchStudent, setSearchStudent] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [printLayoutMode, setPrintLayoutMode] = useState<'cards' | 'table'>('cards');
  const [showKop, setShowKop] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);

  const [draftStudents, setDraftStudents] = useState<(string | StudentRecord)[]>([]);
  const [editingStudent, setEditingStudent] = useState<{
    originalName: string;
    name: string;
    pin: string;
    photo?: string;
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (selectedClass) {
      setDraftStudents(selectedClass.students || []);
    } else {
      setDraftStudents([]);
    }
    setEditingStudent(null);
  }, [selectedClass?.id]);

  useEffect(() => {
    const qClasses = query(collection(db, 'classes'));
    const unsubClasses = onSnapshot(qClasses, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Class));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesList(list);
      setLoading(false);
    }, (err) => {
      console.error("Classes snapshot error:", err);
      setLoading(false);
    });

    let unsubSetting = () => {};
    if (user?.uid) {
      unsubSetting = onSnapshot(doc(db, 'settings', user.uid), (docSnap) => {
        if (docSnap.exists()) {
          setSetting(docSnap.data() as Setting);
        }
      });
    }

    return () => {
      unsubClasses();
      unsubSetting();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (selectedClass) {
      const found = classesList.find(c => c.id === selectedClass.id);
      if (found) {
        setSelectedClass(found);
        setDraftStudents(found.students || []);
      }
    }
  }, [classesList]);

  const fetchClasses = async () => {
    try {
      const snap = await getDocs(collection(db, 'classes'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Class));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesList(list);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!nameInput.trim() || !user) return;
    setProcessing(true);
    try {
      const newName = nameInput.trim();
      if (editingId) {
        const oldClass = Array.isArray(classesList) ? classesList.find(c => c.id === editingId) : undefined;
        await updateDoc(doc(db, 'classes', editingId), { name: newName, adminId: user.uid });
        if (oldClass && oldClass.name !== newName) {
           const examsQ = query(collection(db, 'exams'), where('targetClass', '==', oldClass.name));
           const snap = await getDocs(examsQ);
           if (!snap.empty) {
             const batch = writeBatch(db);
             snap.forEach(d => batch.update(d.ref, { targetClass: newName }));
             await batch.commit();
           }
        }
        if (selectedClass && selectedClass.id === editingId) {
          setSelectedClass(prev => prev ? { ...prev, name: newName } : null);
        }
      } else {
        await addDoc(collection(db, 'classes'), {
          name: newName,
          createdAt: Date.now(),
          adminId: user.uid,
          students: []
        });
      }
      setIsAdding(false);
      setEditingId(null);
      setNameInput('');
      await fetchClasses();
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'classes');
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = (id: string) => {
    setModalConfig({
      title: 'Hapus Kelas',
      description: 'Apakah Anda yakin ingin menghapus kelas ini? Tindakan ini akan menghapus data tersebut secara permanen.',
      idToDelete: id
    });
  };

  const executeDelete = async () => {
    if (!modalConfig || !modalConfig.idToDelete) return;
    setProcessing(true);
    try {
      const oldClass = Array.isArray(classesList) ? classesList.find(c => c.id === modalConfig.idToDelete) : undefined;
      await deleteDoc(doc(db, 'classes', modalConfig.idToDelete));
      if (oldClass) {
         const examsQ = query(collection(db, 'exams'), where('targetClass', '==', oldClass.name));
         const snap = await getDocs(examsQ);
         if (!snap.empty) {
           const batch = writeBatch(db);
           snap.forEach(d => batch.update(d.ref, { targetClass: '' }));
           await batch.commit();
         }
      }
      if (selectedClass && selectedClass.id === modalConfig.idToDelete) {
        setSelectedClass(null);
      }
      setModalConfig(null);
      await fetchClasses();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'classes');
    } finally {
      setProcessing(false);
    }
  };

  const startEdit = (classData: Class) => {
    setEditingId(classData.id!);
    setNameInput(classData.name);
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setNameInput('');
  };

  const saveStudentList = async (updatedStudents: (string | StudentRecord)[]): Promise<boolean> => {
    if (!selectedClass?.id) return false;
    setProcessing(true);
    try {
      const sortedStudents = [...updatedStudents].sort((a, b) => 
        getStudentName(a).localeCompare(getStudentName(b))
      );

      // Clean records to prevent passing 'undefined' fields to Firestore updateDoc
      const cleanedStudents = sortedStudents.map(s => {
        if (typeof s === 'string') {
          return { name: s.trim().toUpperCase(), pin: generateRandomPin() };
        }
        const rec: StudentRecord = {
          name: (s.name || '').trim().toUpperCase(),
          pin: (s.pin || generateRandomPin()).trim()
        };
        if (s.nisn && s.nisn.trim()) rec.nisn = s.nisn.trim();
        if (s.photo && s.photo.trim()) rec.photo = s.photo.trim();
        return rec;
      });

      await updateDoc(doc(db, 'classes', selectedClass.id), {
        students: cleanedStudents
      });
      
      const updatedClassObj = { ...selectedClass, students: cleanedStudents };
      setSelectedClass(updatedClassObj);
      setClassesList(prev => prev.map(c => c.id === selectedClass.id ? updatedClassObj : c));
      setDraftStudents(cleanedStudents);
      showToast('Siswa & Password berhasil disimpan!');
      return true;
    } catch (err: any) {
      console.error("Gagal menyimpan data siswa:", err);
      showToast(err?.message ? `Gagal menyimpan: ${err.message}` : 'Terjadi kesalahan saat menyimpan data siswa.');
      return false;
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkImport = async () => {
    if (!bulkInput.trim() || !selectedClass?.id) return;
    const lines = bulkInput
      .split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);
    
    if (lines.length === 0) return;

    const existingNames = new Set(draftStudents.map(s => getStudentName(s)));
    const newRecords: StudentRecord[] = [];

    for (const line of lines) {
      const parsed = parseStudentInput(line);
      if (parsed.name && !existingNames.has(parsed.name)) {
        existingNames.add(parsed.name);
        newRecords.push(parsed);
      }
    }

    if (newRecords.length === 0) {
      showToast('Tidak ada siswa baru yang diimpor.');
      setShowBulk(false);
      setBulkInput('');
      return;
    }

    const combined = [...draftStudents, ...newRecords];
    setBulkInput('');
    setShowBulk(false);
    await saveStudentList(combined);
  };

  const handleRemoveStudent = async (studentItem: string | StudentRecord) => {
    const targetName = getStudentName(studentItem);
    const updated = draftStudents.filter(s => getStudentName(s) !== targetName);
    await saveStudentList(updated);
  };

  const openEditStudentModal = (item: string | StudentRecord) => {
    const name = getStudentName(item);
    const pin = getStudentPin(item);
    const photo = getStudentPhoto(item) || '';
    setEditingStudent({
      originalName: name,
      name,
      pin,
      photo
    });
  };

  const handleSaveStudentModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent || !selectedClass?.id) return;

    const trimmedName = editingStudent.name.trim().toUpperCase();
    const trimmedPin = editingStudent.pin.trim() || generateRandomPin();
    const trimmedPhoto = (editingStudent.photo || '').trim();

    if (!trimmedName) {
      showToast('Nama siswa tidak boleh kosong.');
      return;
    }

    // Check duplicate name with other students
    const duplicate = draftStudents.some(
      s => getStudentName(s) === trimmedName && getStudentName(s) !== editingStudent.originalName
    );
    if (duplicate) {
      showToast('Siswa dengan nama tersebut sudah ada.');
      return;
    }

    const updated = draftStudents.map(s => {
      if (getStudentName(s) === editingStudent.originalName) {
        const rec: StudentRecord = { name: trimmedName, pin: trimmedPin };
        if (trimmedPhoto) rec.photo = trimmedPhoto;
        return rec;
      }
      return s;
    });

    const success = await saveStudentList(updated);
    if (success) {
      setEditingStudent(null);
      showToast(`Password siswa ${trimmedName} berhasil diubah menjadi: ${trimmedPin}`);
    }
  };

  const handleResetAllPins = () => {
    if (!selectedClass || draftStudents.length === 0) return;
    setModalConfig({
      title: 'Reset Semua PIN Siswa?',
      description: `Sistem akan membuat Password / PIN acak baru untuk seluruh ${draftStudents.length} siswa di kelas "${selectedClass.name}". Lanjutkan?`,
      idToDelete: null,
      confirmText: 'Ya, Reset Semua',
      onConfirm: async () => {
        const updated = draftStudents.map(s => {
          const name = getStudentName(s);
          const photo = getStudentPhoto(s);
          const rec: StudentRecord = {
            name,
            pin: generateRandomPin()
          };
          if (photo) rec.photo = photo;
          return rec;
        });
        await saveStudentList(updated);
        showToast(`PIN seluruh siswa di kelas ${selectedClass.name} berhasil direset acak!`);
      }
    });
  };

  return (
    <div className="w-full flex-1 flex flex-col h-full min-h-0">
      <div className="flex-1 flex flex-col md:flex-row gap-5 h-full min-h-0">
        
        {/* LEFT COLUMN: Daftar Kelas */}
        <div className="w-full md:w-5/12 flex flex-col h-full min-h-0 gap-4">
          <AnimatePresence>
            {isAdding && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm overflow-hidden shrink-0"
              >
                <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-3">{editingId ? 'Edit Kelas' : 'Tambah Kelas'}</h3>
                <div className="flex flex-col gap-2">
                  <input 
                    type="text" 
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Nama Kelas"
                    className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    autoFocus
                  />
                  <div className="flex space-x-1.5 justify-end">
                    <button 
                      onClick={cancelEdit}
                      disabled={processing}
                      className="px-3 py-1.5 border border-slate-300 text-slate-700 text-[11px] font-bold uppercase rounded hover:bg-slate-50 transition-colors cursor-pointer text-center flex items-center justify-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      <span>Batal</span>
                    </button>
                    <button 
                      onClick={handleSave}
                      disabled={processing || !nameInput.trim()}
                      className="flex items-center justify-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50 transition-colors text-[11px] font-bold cursor-pointer text-center uppercase"
                    >
                      {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      <span>Simpan</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Daftar Kelas</h3>
              {!isAdding && (
                <button 
                  onClick={() => setIsAdding(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer text-center flex items-center space-x-1.5 uppercase transition-colors shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  <span>Tambah Kelas</span>
                </button>
              )}
            </div>
            
            <div className="overflow-auto flex-1 p-2">
            {loading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : classesList.length === 0 ? (
              <div className="text-center p-12">
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-slate-400" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">Belum ada kelas</h3>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50 flex flex-col space-y-1">
                {classesList.map((classData, index) => {
                  const isSelected = selectedClass?.id === classData.id;
                  return (
                    <li 
                      key={classData.id} 
                      onClick={() => setSelectedClass(classData)}
                      className={`flex items-center justify-between p-2.5 rounded border transition-all cursor-pointer group ${
                        isSelected 
                          ? 'bg-blue-50/70 border-blue-200 text-blue-750 shadow-xs' 
                          : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-100'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-6 h-6 rounded flex items-center justify-center font-semibold text-[10px] shrink-0 border ${
                          isSelected 
                            ? 'bg-blue-600 text-white border-blue-600' 
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {index + 1}
                        </div>
                        <span className={`text-sm font-semibold ${isSelected ? 'text-blue-700 font-bold' : 'text-slate-800'}`}>
                          {classData.name}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => startEdit(classData)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer text-center"
                          title="Edit Kelas"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDelete(classData.id!)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer text-center"
                          title="Hapus Kelas"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Kelola Siswa Panel */}
        <div className="w-full md:w-7/12 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col h-full min-h-[400px] overflow-hidden">
          {selectedClass === null ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/20">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-blue-100/50">
                <GraduationCap className="w-8 h-8" />
              </div>
              <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-widest mb-2">Kelola Siswa Ujian</h4>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed font-semibold uppercase tracking-wide">
                Silakan pilih kelas di kolom sebelah kiri terlebih dahulu untuk menginput atau mengedit nama & PIN siswa.
              </p>
            </div>
          ) : (() => {
            return (
              <div className="flex-1 flex flex-col h-full min-h-0">
                {/* Panel Header */}
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2">
                    <GraduationCap className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                      Kelola Siswa: <span className="text-blue-700 font-extrabold">{selectedClass.name}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setPrintLayoutMode('cards'); setShowExportModal(true); }}
                      disabled={draftStudents.length === 0}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition shadow-xs disabled:opacity-50"
                      title="Cetak & Export Kartu ID / Credentials PIN Siswa"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Cetak Kartu Siswa</span>
                    </button>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200/50 text-blue-700 text-[9px] font-black uppercase tracking-wider">
                      {draftStudents.length} Siswa
                    </span>
                  </div>
                </div>

                {/* Action Toolbar */}
                <div className="p-3.5 border-b border-slate-100 flex items-center justify-between gap-2.5 shrink-0 bg-white">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBulk(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition shadow-xs"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Impor Banyak Siswa (Bulk)</span>
                    </button>
                    {draftStudents.length > 0 && (
                      <button
                        type="button"
                        onClick={handleResetAllPins}
                        disabled={processing}
                        className="bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition shadow-2xs disabled:opacity-50"
                        title="Buat PIN baru secara acak untuk seluruh siswa di kelas ini"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-700" />
                        <span>Reset Semua PIN Acak</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Student List Search Header */}
                {draftStudents.length > 0 && (
                  <div className="px-4 py-2 bg-slate-50/40 border-b border-slate-100 flex items-center shrink-0">
                    <div className="relative w-full max-w-xs">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchStudent}
                        onChange={(e) => setSearchStudent(e.target.value)}
                        placeholder="Cari nama atau PIN siswa..."
                        className="w-full px-3 py-1 pr-8 pl-8 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded focus:ring-1 focus:ring-blue-500 outline-none uppercase placeholder-slate-400"
                      />
                      {searchStudent && (
                        <button onClick={() => setSearchStudent('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-650">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Student Grid / List */}
                <div className="flex-1 overflow-auto p-4 bg-slate-50/20">
                  {(() => {
                    const filtered = draftStudents.filter(s => {
                      const name = getStudentName(s).toLowerCase();
                      const pin = getStudentPin(s).toLowerCase();
                      const query = searchStudent.toLowerCase();
                      return name.includes(query) || pin.includes(query);
                    });

                    if (draftStudents.length === 0) {
                      return (
                        <div className="text-center py-16 text-slate-400">
                          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <span className="font-semibold uppercase text-[11px] tracking-wider leading-relaxed block text-slate-400">
                            Belum ada data siswa di kelas ini.<br />
                            Klik tombol "Impor Banyak Siswa (Bulk)" di atas untuk menambahkan siswa.
                          </span>
                        </div>
                      );
                    }

                    if (filtered.length === 0) {
                      return (
                        <div className="text-center py-12 text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                          Siswa "{searchStudent}" tidak ditemukan
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {filtered.map((item, idx) => {
                          const name = getStudentName(item);
                          const pin = getStudentPin(item);
                          const originalIndex = draftStudents.findIndex(s => getStudentName(s) === name);

                          return (
                            <div
                              key={name + idx}
                              style={{ contentVisibility: 'auto' }}
                              className="flex items-center justify-between px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-2xs hover:border-blue-300 transition group/item hover:bg-slate-50/60"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className="text-[10px] text-slate-500 group-hover/item:text-blue-600 font-bold bg-slate-100 w-5 h-5 rounded-full flex items-center justify-center border border-slate-200/70 shrink-0">
                                  {originalIndex !== -1 ? originalIndex + 1 : idx + 1}
                                </span>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs text-slate-800 font-bold uppercase tracking-tight truncate">
                                    {name}
                                  </span>
                                  {/* Clickable PIN Badge */}
                                  <button
                                    type="button"
                                    onClick={() => openEditStudentModal(item)}
                                    className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 border border-amber-300 hover:border-amber-400 px-2 py-0.5 rounded-md w-fit mt-0.5 cursor-pointer transition shadow-3xs group/pin"
                                    title="Klik untuk mengubah Password / PIN siswa ini"
                                  >
                                    <Key className="w-3 h-3 text-amber-600 group-hover/pin:rotate-12 transition-transform" />
                                    <span>PIN: {pin}</span>
                                    <Edit2 className="w-2.5 h-2.5 text-amber-600/70 group-hover/pin:text-amber-800 ml-0.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditStudentModal(item)}
                                  className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 bg-white rounded-md transition cursor-pointer shadow-3xs flex items-center gap-1 text-[11px] font-semibold"
                                  title="Edit Nama & PIN Siswa"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">Ubah PIN</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveStudent(item)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 bg-white rounded-md transition cursor-pointer shadow-3xs"
                                  title="Hapus Siswa"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Sticky Action Footer with automatic status indicator */}
                <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wide flex items-center gap-1.5 w-full justify-between">
                    <span className="text-slate-400 flex items-center gap-1.5">
                      {processing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-550" />
                          <span className="text-blue-600 font-bold">Menyimpan perubahan otomatis...</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Perubahan otomatis disimpan ke database</span>
                        </>
                      )}
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium">Auto-Save PIN Aktif</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* Floating Toast Notification - Positioned in Top Right Corner */}
      {toast && (
        <div className="fixed top-4 right-4 z-[100] bg-slate-900 border border-slate-800 text-white font-bold text-[10px] uppercase tracking-wider px-3.5 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>{toast}</span>
        </div>
      )}

      {modalConfig && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-sm w-full overflow-hidden transform animate-in scale-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-base font-bold text-slate-800 mb-2 uppercase tracking-wide">
                {modalConfig.title}
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">
                {modalConfig.description}
              </p>
            </div>

            <div className="bg-slate-50 px-6 py-4 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setModalConfig(null)}
                className="px-4 py-2 hover:bg-slate-200 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition flex-1"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (modalConfig.onConfirm) {
                    await modalConfig.onConfirm();
                    setModalConfig(null);
                  } else {
                    await executeDelete();
                  }
                }}
                disabled={processing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 flex-1 justify-center disabled:opacity-50"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                <span>{modalConfig.confirmText || 'Hapus'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Siswa & Password / PIN */}
      {editingStudent && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-[90] animate-in fade-in duration-200">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 text-amber-700 flex items-center justify-center shadow-3xs">
                  <Key className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">
                    Edit Password & Siswa
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Kelas: <span className="text-blue-600 font-extrabold">{selectedClass?.name}</span>
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setEditingStudent(null)} 
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudentModal} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 uppercase mb-1">
                  Nama Lengkap Siswa *
                </label>
                <input
                  type="text"
                  required
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  placeholder="Contoh: AHMAD IBRAHIM"
                  className="w-full px-3 py-2 text-xs font-bold uppercase bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  autoFocus
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-extrabold text-slate-700 uppercase flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-amber-600" />
                    <span>Password / PIN Ujian Siswa *</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-bold">Wajib Diisi</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={editingStudent.pin}
                    onChange={(e) => setEditingStudent({ ...editingStudent, pin: e.target.value })}
                    placeholder="Contoh: 12345"
                    className="flex-1 px-3 py-2 text-sm font-mono font-bold bg-white border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 tracking-widest text-center"
                  />
                  <button
                    type="button"
                    onClick={() => setEditingStudent({ ...editingStudent, pin: generateRandomPin() })}
                    className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-3xs shrink-0"
                    title="Buat PIN acak baru otomatis"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-700" />
                    <span>Acak PIN</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed font-medium">
                  💡 Ketik password bebas (angka/huruf) atau klik <strong>Acak PIN</strong> untuk menghasilkan 5 digit acak.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold text-slate-600 uppercase mb-1">
                  Link Foto Siswa (Opsional)
                </label>
                <input
                  type="url"
                  value={editingStudent.photo || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, photo: e.target.value })}
                  placeholder="https://drive.google.com/file/d/..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  disabled={processing}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-bold uppercase rounded-lg hover:bg-slate-50 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={processing || !editingStudent.name.trim() || !editingStudent.pin.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold uppercase rounded-lg transition cursor-pointer flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{processing ? 'Menyimpan...' : 'Simpan Password'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showBulk && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden transform animate-in scale-in-95 duration-200 flex flex-col h-[480px]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                  Impor Banyak Siswa Sekaligus
                </h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">
                  Format per Baris: "NAMA SISWA" atau "NAMA SISWA, PIN"
                </p>
              </div>
              <button 
                onClick={() => setShowBulk(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-50 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex-1 flex flex-col min-h-0 bg-slate-50/30">
              <p className="text-[11px] text-slate-600 uppercase font-semibold tracking-wide mb-2.5">
                Contoh Input: <br />
                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-800 font-mono">IMAM BISHRY NURYAYI</code> (Password dibuat acak otomatis)<br />
                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-800 font-mono">AI NUR ROIAH, 98765</code> (Password kustom)
              </p>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={"IMAM BISHRY NURYAYI\nAI NUR ROIAH\nAI NUR ROIAH, 54321"}
                className="flex-1 w-full p-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500/25 focus:border-blue-500 outline-none uppercase font-semibold text-slate-700 leading-relaxed placeholder-slate-400 resize-none font-mono"
                autoFocus
              />
            </div>

            <div className="bg-slate-50 px-5 py-4 border-t border-slate-100 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowBulk(false);
                  setBulkInput('');
                }}
                className="px-4 py-2 hover:bg-slate-200 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleBulkImport}
                disabled={processing || !bulkInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 disabled:opacity-50 shadow-sm"
              >
                <span>Proses Impor</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Export / Cetak Kartu Login & Credentials Siswa */}
      {showExportModal && selectedClass && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full h-[90vh] max-h-[850px] overflow-hidden flex flex-col transform animate-in scale-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                    Cetak Kartu Login Siswa
                  </h3>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                    Kelas: <span className="text-blue-700 font-black">{selectedClass.name}</span> • {draftStudents.length} Siswa Terdaftar
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowExportModal(false)} 
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-full hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Customization Controls Bar */}
            <div className="px-4 py-3 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
              {/* Layout Mode Switcher */}
              <div className="flex items-center gap-1.5 bg-slate-200/80 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPrintLayoutMode('cards')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer ${
                    printLayoutMode === 'cards' 
                      ? 'bg-white text-blue-700 shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Kartu Siswa (Grid ID)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintLayoutMode('table')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer ${
                    printLayoutMode === 'table' 
                      ? 'bg-white text-blue-700 shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>Daftar Tabel (DUK)</span>
                </button>
              </div>

              {/* Kop Toggle */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showKop}
                    onChange={(e) => setShowKop(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span>Tampilkan Kop Sekolah & Logo</span>
                </label>
              </div>
            </div>

            {/* Printable Preview Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/50 custom-scrollbar">
              <div 
                id="printable-cards-container" 
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm max-w-3xl mx-auto"
              >
                {/* Header Ringkasan Cetak */}
                <div className="border-b pb-3 mb-4 text-center">
                  <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full text-blue-800 text-[11px] font-bold uppercase mb-1">
                    <Users className="w-3.5 h-3.5 text-blue-600" />
                    <span>Total {draftStudents.length} Siswa Terdaftar • Siap Cetak A4</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Semua kartu otomatis tersusun lengkap ke seluruh halaman (multi-page). Kartu tidak akan terpotong oleh batas halaman.
                  </p>
                </div>

                {printLayoutMode === 'cards' ? (
                  /* MODE KARTU SISWA GRID (PREVIEW) */
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {draftStudents.map((s, idx) => {
                        const name = getStudentName(s);
                        const pin = getStudentPin(s);

                        return (
                          <div 
                            key={idx} 
                            className="border-2 border-dashed border-slate-300 rounded-xl p-3.5 bg-white flex flex-col justify-between relative shadow-3xs hover:border-blue-300 transition"
                          >
                            {/* Kop Kartu */}
                            {showKop && (
                              <div className="flex items-center gap-2.5 pb-2 mb-2 border-b-2 border-slate-900">
                                <img 
                                  src={setting?.schoolLogo || brandLogo} 
                                  alt="Logo Sekolah" 
                                  className="w-9 h-9 object-contain shrink-0" 
                                />
                                <div className="min-w-0 flex-1 text-center">
                                  <h4 className="text-[11px] font-black uppercase text-slate-900 tracking-tight leading-tight">
                                    {setting?.schoolName || 'EXAM PRO PLUS - CBT'}
                                  </h4>
                                  <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wider leading-none mt-0.5 truncate">
                                    {setting?.schoolSlogan || setting?.schoolAddress || 'KARTU LOGIN PESERTA UJIAN'}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Badge Header Kartu */}
                            <div className="flex items-center justify-center bg-slate-900 text-white px-2.5 py-1 rounded-md mb-2">
                              <span className="text-[9px] font-black tracking-widest uppercase">KARTU PESERTA UJIAN</span>
                            </div>

                            {/* Details Grid with Photo */}
                            <div className="flex gap-3 items-center flex-1">
                              {/* Student Photo Frame (2x3 ratio size e.g. w-12 h-16) */}
                              <div className="w-12 h-16 bg-slate-100 border-2 border-slate-300 rounded-md overflow-hidden shrink-0 flex items-center justify-center relative shadow-3xs">
                                {getStudentPhoto(s) ? (
                                  <img 
                                    src={getStudentPhoto(s)!} 
                                    alt={name} 
                                    className="w-full h-full object-cover" 
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-slate-400 p-1 text-center">
                                    <UserCircle className="w-6 h-6 text-slate-300" />
                                    <span className="text-[6px] font-bold uppercase tracking-tighter leading-none mt-0.5">2x3</span>
                                  </div>
                                )}
                              </div>

                              <div className="space-y-1.5 flex-1 min-w-0">
                                <div>
                                  <div className="text-[7px] font-bold text-slate-400 uppercase tracking-wider">NAMA SISWA</div>
                                  <div className="text-xs font-black text-slate-900 uppercase truncate bg-slate-50 border border-slate-200 px-2 py-0.5 rounded mt-0.5">
                                    {name}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-1.5">
                                  <div>
                                    <div className="text-[7px] font-bold text-slate-400 uppercase tracking-wider">KELAS</div>
                                    <div className="text-[10px] font-bold text-slate-800 uppercase bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded mt-0.5 truncate">
                                      {selectedClass.name}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-[7px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-0.5">
                                      <Key className="w-2 h-2" /> PIN
                                    </div>
                                    <div className="text-[11px] font-mono font-black text-amber-900 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded text-center tracking-widest mt-0.5">
                                      {pin}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Card Footer */}
                            <div className="mt-2.5 pt-1.5 border-t border-slate-200 flex items-center justify-between text-[8px] text-slate-400 font-bold uppercase">
                              <span>Portal Ujian: /</span>
                              <span className="flex items-center gap-0.5 text-slate-400">
                                <Scissors className="w-2.5 h-2.5" /> Gunting di sini
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* MODE TABEL DAFTAR (DUK - PREVIEW) */
                  <div className="space-y-5">
                    {showKop && (
                      <div className="flex items-center justify-between border-b-4 border-double border-slate-900 pb-3 mb-4">
                        <img 
                          src={setting?.schoolLogo || brandLogo} 
                          alt="Logo Sekolah" 
                          className="w-16 h-16 object-contain shrink-0" 
                        />
                        <div className="text-center flex-1 mx-4">
                          <h2 className="text-base font-black uppercase text-slate-900 tracking-wider">
                            {setting?.schoolName || 'EXAM PRO PLUS ASSESSMENT'}
                          </h2>
                          <h3 className="text-xs font-extrabold uppercase text-slate-800 mt-0.5">
                            DAFTAR KARTU LOGIN & CREDENTIALS PESERTA UJIAN
                          </h3>
                          <p className="text-[10px] font-semibold text-slate-600 mt-1">
                            {setting?.schoolAddress || setting?.schoolSlogan || 'Sistem Penilaian Digital Berbasis Komputer & Mobile'}
                          </p>
                        </div>
                        <div className="w-16 shrink-0 text-right text-[10px] font-bold text-slate-400 uppercase">
                          KELAS<br />
                          <span className="text-sm font-black text-slate-900">{selectedClass.name}</span>
                        </div>
                      </div>
                    )}

                    {!showKop && (
                      <div className="text-center border-b pb-3">
                        <h2 className="text-base font-extrabold uppercase text-slate-900">DAFTAR KARTU LOGIN & CREDENTIALS SISWA</h2>
                        <p className="text-xs font-bold text-slate-600 uppercase">KELAS: {selectedClass.name}</p>
                      </div>
                    )}

                    <table className="w-full text-left border-collapse border border-slate-400">
                      <thead>
                        <tr className="bg-slate-100 text-slate-900 text-[11px] font-black uppercase tracking-wider">
                          <th className="border border-slate-400 px-3 py-2 text-center w-10">No</th>
                          <th className="border border-slate-400 px-3 py-2">Nama Lengkap Siswa</th>
                          <th className="border border-slate-400 px-3 py-2 text-center w-28">Kelas</th>
                          <th className="border border-slate-400 px-3 py-2 text-center w-36">Password / PIN</th>
                          <th className="border border-slate-400 px-3 py-2 text-center w-32">Tanda Tangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftStudents.map((s, i) => (
                          <tr key={i} className="hover:bg-slate-50 border-b border-slate-300">
                            <td className="border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-500">{i + 1}</td>
                            <td className="border border-slate-300 px-3 py-2 text-xs font-bold text-slate-900 uppercase">{getStudentName(s)}</td>
                            <td className="border border-slate-300 px-3 py-2 text-center text-xs font-semibold text-slate-700 uppercase">{selectedClass.name}</td>
                            <td className="border border-slate-300 px-3 py-2 text-center text-xs font-mono font-black text-amber-900 bg-amber-50/50">{getStudentPin(s)}</td>
                            <td className="border border-slate-300 px-3 py-2 text-center text-[10px] text-slate-400">
                              {i + 1}. ....................
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="pt-6 flex justify-between items-end text-xs text-slate-800">
                      <div>
                        <p className="font-bold text-[10px] text-slate-500 uppercase">Catatan Pengawas:</p>
                        <p className="text-[10px] text-slate-600">Jaga kerahasiaan Password/PIN peserta ujian.</p>
                      </div>
                      <div className="text-center font-semibold">
                        <p className="text-[10px] uppercase font-bold text-slate-600">Pengawas / Guru Mata Pelajaran</p>
                        <div className="h-14"></div>
                        <p className="font-black underline text-slate-900 uppercase">( ............................................ )</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="bg-slate-50 px-5 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  const text = draftStudents.map((s, i) => `${i + 1}. ${getStudentName(s)} — PIN: ${getStudentPin(s)}`).join('\n');
                  navigator.clipboard.writeText(`KELAS: ${selectedClass.name}\n\n` + text);
                  showToast('Daftar PIN berhasil disalin ke clipboard!');
                }}
                className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition flex items-center gap-1.5 border border-slate-300 shadow-2xs"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Teks</span>
              </button>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 hover:bg-slate-200 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 shadow-md hover:shadow-lg"
                  title="Cetak langsung ke printer atau Simpan sebagai file PDF"
                >
                  <Printer className="w-4 h-4" />
                  <span>Cetak / Simpan PDF ({draftStudents.length} Kartu)</span>
                </button>
              </div>
            </div>

            {/* Dedicated Top-Level Print Portal directly into document.body for flawless multi-page pagination */}
            {typeof document !== 'undefined' && createPortal(
              <div id="exam-cards-print-portal" className="hidden print:block">
                <style>{`
                  @media screen {
                    #exam-cards-print-portal {
                      display: none !important;
                    }
                  }
                  @media print {
                    #root {
                      display: none !important;
                    }
                    body > *:not(#exam-cards-print-portal) {
                      display: none !important;
                    }
                    html, body {
                      margin: 0 !important;
                      padding: 0 !important;
                      background: #ffffff !important;
                      color: #000000 !important;
                      height: auto !important;
                      min-height: 0 !important;
                      overflow: visible !important;
                    }
                    @page {
                      size: A4 portrait;
                      margin: 8mm 8mm 8mm 8mm;
                    }
                    #exam-cards-print-portal {
                      display: block !important;
                      position: static !important;
                      width: 100% !important;
                      margin: 0 !important;
                      padding: 0 !important;
                      background: #ffffff !important;
                      overflow: visible !important;
                    }
                    .print-portal-grid {
                      display: flex !important;
                      flex-wrap: wrap !important;
                      justify-content: space-between !important;
                      width: 100% !important;
                    }
                    .print-portal-card {
                      width: 48.5% !important;
                      box-sizing: border-box !important;
                      break-inside: avoid !important;
                      page-break-inside: avoid !important;
                      -webkit-column-break-inside: avoid !important;
                      margin-bottom: 5mm !important;
                    }
                    .print-portal-table {
                      width: 100% !important;
                      border-collapse: collapse !important;
                    }
                    .print-portal-table thead {
                      display: table-header-group !important;
                    }
                    .print-portal-table tr {
                      break-inside: avoid !important;
                      page-break-inside: avoid !important;
                    }
                  }
                `}</style>

                {printLayoutMode === 'cards' ? (
                  /* DIRECT PRINT CARDS GRID (ALL PAGES) */
                  <div className="print-portal-grid">
                    {draftStudents.map((s, idx) => {
                      const name = getStudentName(s);
                      const pin = getStudentPin(s);

                      return (
                        <div 
                          key={idx} 
                          className="print-portal-card border-2 border-dashed border-slate-400 rounded-xl p-3 bg-white flex flex-col justify-between"
                          style={{ minHeight: '62mm' }}
                        >
                          {/* Kop Kartu */}
                          {showKop && (
                            <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b-2 border-slate-900">
                              <img 
                                src={setting?.schoolLogo || brandLogo} 
                                alt="Logo Sekolah" 
                                className="w-8 h-8 object-contain shrink-0" 
                              />
                              <div className="min-w-0 flex-1 text-center">
                                <h4 className="text-[10px] font-black uppercase text-slate-900 tracking-tight leading-tight">
                                  {setting?.schoolName || 'EXAM PRO PLUS - CBT'}
                                </h4>
                                <p className="text-[7.5px] font-bold text-slate-600 uppercase tracking-wider leading-none mt-0.5 truncate">
                                  {setting?.schoolSlogan || setting?.schoolAddress || 'KARTU LOGIN PESERTA UJIAN'}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Badge Header Kartu */}
                          <div className="flex items-center justify-center bg-slate-900 text-white px-2 py-0.5 rounded mb-1.5">
                            <span className="text-[8.5px] font-black tracking-widest uppercase">KARTU PESERTA UJIAN</span>
                          </div>

                          {/* Details with Photo 2x3 */}
                          <div className="flex gap-2.5 items-center flex-1">
                            <div className="w-12 h-16 bg-slate-100 border border-slate-400 rounded overflow-hidden shrink-0 flex items-center justify-center relative">
                              {getStudentPhoto(s) ? (
                                <img 
                                  src={getStudentPhoto(s)!} 
                                  alt={name} 
                                  className="w-full h-full object-cover" 
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-slate-400 p-1 text-center">
                                  <UserCircle className="w-6 h-6 text-slate-300" />
                                  <span className="text-[6px] font-bold uppercase tracking-tighter leading-none mt-0.5">2x3</span>
                                </div>
                              )}
                            </div>

                            <div className="space-y-1 flex-1 min-w-0">
                              <div>
                                <div className="text-[6.5px] font-bold text-slate-500 uppercase tracking-wider">NAMA SISWA</div>
                                <div className="text-[11px] font-black text-slate-900 uppercase truncate bg-slate-50 border border-slate-300 px-1.5 py-0.5 rounded mt-0.5">
                                  {name}
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <div className="text-[6.5px] font-bold text-slate-500 uppercase tracking-wider">KELAS</div>
                                  <div className="text-[9.5px] font-bold text-slate-800 uppercase bg-slate-50 border border-slate-300 px-1 py-0.5 rounded mt-0.5 truncate">
                                    {selectedClass.name}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[6.5px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-0.5">
                                    <Key className="w-2 h-2" /> PIN
                                  </div>
                                  <div className="text-[11px] font-mono font-black text-amber-950 bg-amber-50 border border-amber-400 px-1.5 py-0.5 rounded text-center tracking-widest mt-0.5">
                                    {pin}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Card Footer */}
                          <div className="mt-1.5 pt-1 border-t border-slate-300 flex items-center justify-between text-[7.5px] text-slate-500 font-bold uppercase">
                            <span>Portal Ujian: /</span>
                            <span className="flex items-center gap-0.5 text-slate-500">
                              <Scissors className="w-2.5 h-2.5" /> Gunting di sini
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* DIRECT PRINT TABLE (DUK - ALL PAGES) */
                  <div>
                    {showKop && (
                      <div className="flex items-center justify-between border-b-4 border-double border-slate-900 pb-3 mb-4">
                        <img 
                          src={setting?.schoolLogo || brandLogo} 
                          alt="Logo Sekolah" 
                          className="w-14 h-14 object-contain shrink-0" 
                        />
                        <div className="text-center flex-1 mx-4">
                          <h2 className="text-sm font-black uppercase text-slate-900 tracking-wider">
                            {setting?.schoolName || 'EXAM PRO PLUS ASSESSMENT'}
                          </h2>
                          <h3 className="text-xs font-extrabold uppercase text-slate-800 mt-0.5">
                            DAFTAR KARTU LOGIN & CREDENTIALS PESERTA UJIAN
                          </h3>
                          <p className="text-[9.5px] font-semibold text-slate-600 mt-0.5">
                            {setting?.schoolAddress || setting?.schoolSlogan || 'Sistem Penilaian Digital Berbasis Komputer & Mobile'}
                          </p>
                        </div>
                        <div className="w-14 shrink-0 text-right text-[9.5px] font-bold text-slate-500 uppercase">
                          KELAS<br />
                          <span className="text-xs font-black text-slate-900">{selectedClass.name}</span>
                        </div>
                      </div>
                    )}

                    {!showKop && (
                      <div className="text-center border-b pb-3 mb-4">
                        <h2 className="text-sm font-extrabold uppercase text-slate-900">DAFTAR KARTU LOGIN & CREDENTIALS SISWA</h2>
                        <p className="text-xs font-bold text-slate-600 uppercase">KELAS: {selectedClass.name}</p>
                      </div>
                    )}

                    <table className="print-portal-table w-full text-left border border-slate-400">
                      <thead>
                        <tr className="bg-slate-100 text-slate-900 text-[10px] font-black uppercase tracking-wider">
                          <th className="border border-slate-400 px-2 py-1.5 text-center w-8">No</th>
                          <th className="border border-slate-400 px-2 py-1.5">Nama Lengkap Siswa</th>
                          <th className="border border-slate-400 px-2 py-1.5 text-center w-24">Kelas</th>
                          <th className="border border-slate-400 px-2 py-1.5 text-center w-28">Password / PIN</th>
                          <th className="border border-slate-400 px-2 py-1.5 text-center w-28">Tanda Tangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftStudents.map((s, i) => (
                          <tr key={i} className="border-b border-slate-300">
                            <td className="border border-slate-300 px-2 py-1.5 text-center text-[10px] font-semibold text-slate-600">{i + 1}</td>
                            <td className="border border-slate-300 px-2 py-1.5 text-[10px] font-bold text-slate-900 uppercase">{getStudentName(s)}</td>
                            <td className="border border-slate-300 px-2 py-1.5 text-center text-[10px] font-semibold text-slate-700 uppercase">{selectedClass.name}</td>
                            <td className="border border-slate-300 px-2 py-1.5 text-center text-[10px] font-mono font-black text-amber-950 bg-amber-50/50">{getStudentPin(s)}</td>
                            <td className="border border-slate-300 px-2 py-1.5 text-center text-[9px] text-slate-400">
                              {i + 1}. ....................
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="pt-5 flex justify-between items-end text-xs text-slate-800" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                      <div>
                        <p className="font-bold text-[9px] text-slate-500 uppercase">Catatan Pengawas:</p>
                        <p className="text-[9px] text-slate-600">Jaga kerahasiaan Password/PIN peserta ujian.</p>
                      </div>
                      <div className="text-center font-semibold">
                        <p className="text-[9px] uppercase font-bold text-slate-600">Pengawas / Guru Mata Pelajaran</p>
                        <div className="h-10"></div>
                        <p className="font-black underline text-slate-900 uppercase text-[10px]">( ............................................ )</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>,
              document.body
            )}

          </div>
        </div>
      )}
    </div>
  );
}
