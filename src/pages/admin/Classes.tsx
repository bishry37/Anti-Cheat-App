import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, where, writeBatch } from 'firebase/firestore';
import { Class, StudentRecord } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Users, Search, ArrowRight, GraduationCap, Check, Key, Copy, Printer, RefreshCw, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { getStudentName, getStudentPin, generateDefaultPin, normalizeStudentRecord, parseStudentInput } from '../../utils/studentUtils';

export default function Classes() {
  const { user } = useAuth();
  const [classesList, setClassesList] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [modalConfig, setModalConfig] = useState<{
    title: string;
    description: string;
    idToDelete: string | null;
  } | null>(null);

  // Student list state variables
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [studentInput, setStudentInput] = useState('');
  const [studentPinInput, setStudentPinInput] = useState('');
  const [searchStudent, setSearchStudent] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [draftStudents, setDraftStudents] = useState<(string | StudentRecord)[]>([]);
  const [editingStudentIndex, setEditingStudentIndex] = useState<number | null>(null);
  const [editingStudentValue, setEditingStudentValue] = useState('');
  const [editingStudentPinValue, setEditingStudentPinValue] = useState('');

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
    setEditingStudentIndex(null);
    setEditingStudentValue('');
    setEditingStudentPinValue('');
  }, [selectedClass?.id]);

  useEffect(() => {
    if (user) fetchClasses();
  }, [user]);

  const fetchClasses = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'classes'), where('adminId', '==', user.uid));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Class));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setClassesList(list);
      if (selectedClass) {
        const found = list.find(c => c.id === selectedClass.id);
        if (found) setSelectedClass(found);
        else setSelectedClass(null);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
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
           const examsQ = query(collection(db, 'exams'), where('targetClass', '==', oldClass.name), where('adminId', '==', user.uid));
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
      if (oldClass && user) {
         const examsQ = query(collection(db, 'exams'), where('targetClass', '==', oldClass.name), where('adminId', '==', user.uid));
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

  const saveStudentList = async (updatedStudents: (string | StudentRecord)[]) => {
    if (!selectedClass?.id) return;
    setProcessing(true);
    try {
      const sortedStudents = [...updatedStudents].sort((a, b) => 
        getStudentName(a).localeCompare(getStudentName(b))
      );
      await updateDoc(doc(db, 'classes', selectedClass.id), {
        students: sortedStudents
      });
      
      const updatedClassObj = { ...selectedClass, students: sortedStudents };
      setSelectedClass(updatedClassObj);
      setClassesList(prev => prev.map(c => c.id === selectedClass.id ? updatedClassObj : c));
      setDraftStudents(sortedStudents);
      showToast('Siswa & PIN berhasil disimpan ke database!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'classes');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddStudent = async () => {
    if (!studentInput.trim() || !selectedClass?.id) return;
    const name = studentInput.trim().toUpperCase();
    const existingNames = draftStudents.map(s => getStudentName(s));
    if (existingNames.includes(name)) {
      showToast('Siswa dengan nama tersebut sudah ada.');
      return;
    }
    const pin = studentPinInput.trim() || generateDefaultPin();
    const newRecord: StudentRecord = { name, pin };
    const updated = [...draftStudents, newRecord];
    setStudentInput('');
    setStudentPinInput('');
    await saveStudentList(updated);
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

  const handleGenerateAllPins = async () => {
    if (!selectedClass?.id || draftStudents.length === 0) return;
    const updated = draftStudents.map(s => {
      const name = getStudentName(s);
      return { name, pin: generateDefaultPin() };
    });
    await saveStudentList(updated);
    showToast('PIN baru berhasil dibuat untuk semua siswa!');
  };

  const handleRemoveStudent = async (studentItem: string | StudentRecord) => {
    const targetName = getStudentName(studentItem);
    const updated = draftStudents.filter(s => getStudentName(s) !== targetName);
    await saveStudentList(updated);
  };

  const startEditStudent = (idx: number, item: string | StudentRecord) => {
    setEditingStudentIndex(idx);
    setEditingStudentValue(getStudentName(item));
    setEditingStudentPinValue(getStudentPin(item));
  };

  const handleSaveStudentEdit = async (idx: number) => {
    const val = editingStudentValue.trim().toUpperCase();
    if (!val) return;
    
    // Check duplicate
    const otherNames = draftStudents.filter((_, i) => i !== idx).map(s => getStudentName(s));
    if (otherNames.includes(val)) {
      showToast('Siswa dengan nama tersebut sudah ada.');
      return;
    }
    
    const pin = editingStudentPinValue.trim() || generateDefaultPin();
    const updated = [...draftStudents];
    updated[idx] = { name: val, pin };
    setEditingStudentIndex(null);
    setEditingStudentValue('');
    setEditingStudentPinValue('');
    await saveStudentList(updated);
  };

  const handleCancelStudentEdit = () => {
    setEditingStudentIndex(null);
    setEditingStudentValue('');
    setEditingStudentPinValue('');
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
                      onClick={() => setShowExportModal(true)}
                      disabled={draftStudents.length === 0}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
                      title="Cetak & Export Daftar PIN Siswa"
                    >
                      <Printer className="w-3 h-3 text-slate-600" />
                      <span>Cetak PIN</span>
                    </button>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200/50 text-blue-700 text-[9px] font-black uppercase tracking-wider">
                      {draftStudents.length} Siswa
                    </span>
                  </div>
                </div>

                {/* Input forms */}
                <div className="p-4 border-b border-slate-100 flex flex-col gap-3 shrink-0 bg-white">
                  {/* Single Student Add with optional PIN */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={studentInput}
                        onChange={(e) => setStudentInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
                        placeholder="Nama siswa (Contoh: BUDI SETIAWAN)..."
                        className="w-full px-3 py-1.5 pl-8 text-xs font-semibold bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all uppercase placeholder-slate-400"
                      />
                      <Users className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    <div className="relative w-full sm:w-36">
                      <input
                        type="text"
                        value={studentPinInput}
                        onChange={(e) => setStudentPinInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
                        placeholder="PIN (Otomatis jika kosong)"
                        className="w-full px-3 py-1.5 pl-7 text-xs font-mono font-bold bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all uppercase placeholder-slate-400"
                        maxLength={8}
                      />
                      <Key className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    <button
                      onClick={handleAddStudent}
                      disabled={processing || !studentInput.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded text-[10px] font-bold uppercase transition-colors shrink-0 flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah</span>
                    </button>
                  </div>

                  {/* Secondary Action Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowBulk(true)}
                      className="text-blue-600 hover:text-blue-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Impor Banyak Siswa (Bulk Import)</span>
                    </button>
                    {draftStudents.length > 0 && (
                      <button
                        type="button"
                        onClick={handleGenerateAllPins}
                        disabled={processing}
                        className="text-amber-700 hover:text-amber-800 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:underline disabled:opacity-50"
                        title="Acak & buat PIN 4-digit baru untuk seluruh siswa di kelas ini"
                      >
                        <RefreshCw className="w-3 h-3 text-amber-600" />
                        <span>Acak PIN Semua Siswa</span>
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
                          <span className="font-semibold uppercase text-[10px] tracking-wider leading-relaxed block text-slate-400">
                            Belum ada data siswa<br />Input di atas untuk menambah siswa
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
                          const originalIndex = draftStudents.indexOf(item);
                          const isEditingThis = editingStudentIndex === originalIndex;
                          const name = getStudentName(item);
                          const pin = getStudentPin(item);

                          return (
                            <div
                              key={name + idx}
                              style={{ contentVisibility: 'auto' }}
                              className={`flex items-center justify-between px-3 py-2 bg-white border rounded-lg shadow-2xs hover:border-blue-200 transition group/item hover:bg-slate-50/50 ${
                                isEditingThis ? 'border-blue-500 ring-2 ring-blue-500/10' : 'border-slate-150/80'
                              }`}
                            >
                              {isEditingThis ? (
                                <div className="flex items-center gap-1.5 w-full">
                                  <input
                                    type="text"
                                    value={editingStudentValue}
                                    onChange={(e) => setEditingStudentValue(e.target.value)}
                                    placeholder="NAMA SISWA"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveStudentEdit(originalIndex);
                                      if (e.key === 'Escape') handleCancelStudentEdit();
                                    }}
                                    className="flex-1 min-w-0 px-2 py-1 text-xs font-bold uppercase bg-slate-50 border border-blue-400 rounded outline-none focus:bg-white"
                                    autoFocus
                                  />
                                  <input
                                    type="text"
                                    value={editingStudentPinValue}
                                    onChange={(e) => setEditingStudentPinValue(e.target.value)}
                                    placeholder="PIN"
                                    className="w-16 px-1.5 py-1 text-xs font-mono font-bold bg-slate-50 border border-blue-400 rounded outline-none focus:bg-white text-center"
                                  />
                                  <button
                                    onClick={() => handleSaveStudentEdit(originalIndex)}
                                    className="p-1 px-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded cursor-pointer transition text-xs font-bold"
                                    title="Simpan"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={handleCancelStudentEdit}
                                    className="p-1 px-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded cursor-pointer transition text-xs font-bold"
                                    title="Batal"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="text-[9px] text-slate-400 group-hover/item:text-blue-500 font-semibold bg-slate-50 w-5 h-5 rounded-full flex items-center justify-center border border-slate-100/50 shrink-0">
                                      {originalIndex + 1}
                                    </span>
                                    <div className="flex flex-col min-w-0">
                                      <span className="text-xs text-slate-800 font-bold uppercase tracking-tight truncate">
                                        {name}
                                      </span>
                                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-amber-700 bg-amber-50 border border-amber-200/70 px-1.5 py-0.2 rounded w-fit mt-0.5">
                                        <Key className="w-2.5 h-2.5 text-amber-600" />
                                        PIN: {pin}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 opacity-90 group-hover/item:opacity-100 shrink-0">
                                    <button
                                      onClick={() => startEditStudent(originalIndex, item)}
                                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition cursor-pointer"
                                      title="Edit Nama & PIN Siswa"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveStudent(item)}
                                      className="p-1 text-slate-350 hover:text-red-500 hover:bg-red-50 rounded transition cursor-pointer"
                                      title="Hapus Siswa"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </>
                              )}
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
                onClick={executeDelete}
                disabled={processing}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-2 flex-1 justify-center disabled:opacity-50"
              >
                {processing && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                <span>Hapus</span>
              </button>
            </div>
          </div>
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
              <p className="text-[11px] text-slate-500 uppercase font-semibold tracking-wide mb-2.5">
                Contoh: <br />
                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-800">BUDI SETIAWAN</code> (PIN diacak otomatis)<br />
                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-800">ANI SETYAWATI, 4812</code> (PIN kustom)
              </p>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={"BUDI SETIAWAN\nANI SETYAWATI, 4812\nIMAM BISHRY NURYAYI, 9901"}
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

      {/* Modal Export / Cetak Credentials PIN Siswa */}
      {showExportModal && selectedClass && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col transform animate-in scale-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Daftar Credentials PIN Siswa — {selectedClass.name}
                  </h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    {draftStudents.length} Siswa Terdaftar
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowExportModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-auto bg-white">
              <div id="printable-student-pins" className="space-y-4">
                <div className="text-center border-b pb-3">
                  <h2 className="text-base font-extrabold uppercase text-slate-900">KARTU LOGIN & CREDENTIALS PIN SISWA</h2>
                  <p className="text-xs font-bold text-slate-600 uppercase">KELAS: {selectedClass.name}</p>
                </div>
                <table className="w-full text-left border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800 text-[11px] uppercase tracking-wider">
                      <th className="border border-slate-300 px-3 py-2 text-center w-12">No</th>
                      <th className="border border-slate-300 px-3 py-2">Nama Siswa</th>
                      <th className="border border-slate-300 px-3 py-2 text-center w-36">Password / PIN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftStudents.map((s, i) => (
                      <tr key={i} className="hover:bg-slate-50 border-b border-slate-200">
                        <td className="border border-slate-300 px-3 py-1.5 text-center text-xs font-semibold text-slate-500">{i + 1}</td>
                        <td className="border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 uppercase">{getStudentName(s)}</td>
                        <td className="border border-slate-300 px-3 py-1.5 text-center text-xs font-mono font-bold text-blue-700 bg-blue-50/40">{getStudentPin(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-50 px-5 py-4 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const text = draftStudents.map((s, i) => `${i + 1}. ${getStudentName(s)} — PIN: ${getStudentPin(s)}`).join('\n');
                  navigator.clipboard.writeText(`KELAS: ${selectedClass.name}\n\n` + text);
                  showToast('Daftar PIN berhasil disalin ke clipboard!');
                }}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition flex items-center gap-1.5 border border-slate-300"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Salin Teks</span>
              </button>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 hover:bg-slate-200 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition cursor-pointer flex items-center space-x-1.5 shadow-sm"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak (Print)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
