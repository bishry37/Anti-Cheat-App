import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, where, writeBatch } from 'firebase/firestore';
import { Class } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Users, Search, ArrowRight, GraduationCap, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';

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
  const [searchStudent, setSearchStudent] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [draftStudents, setDraftStudents] = useState<string[]>([]);
  const [editingStudentIndex, setEditingStudentIndex] = useState<number | null>(null);
  const [editingStudentValue, setEditingStudentValue] = useState('');

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
    }
    setProcessing(false);
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
    }
    setProcessing(false);
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

  const handleAddStudent = () => {
    if (!studentInput.trim() || !selectedClass?.id) return;
    const newStudent = studentInput.trim().toUpperCase();
    if (draftStudents.includes(newStudent)) {
      showToast('Siswa dengan nama tersebut sudah ada di rancangan.');
      return;
    }
    setDraftStudents(prev => [...prev, newStudent].sort());
    setStudentInput('');
    showToast('Siswa ditambahkan ke rancangan (Klik Simpan untuk menyimpan)');
  };

  const handleBulkImport = () => {
    if (!bulkInput.trim() || !selectedClass?.id) return;
    const names = bulkInput
      .split('\n')
      .map(n => n.trim().toUpperCase())
      .filter(n => n.length > 0);
    
    if (names.length === 0) return;

    const combined = Array.from(new Set([...draftStudents, ...names])).sort();
    setDraftStudents(combined);
    setBulkInput('');
    setShowBulk(false);
    showToast(`${names.length} siswa ditambahkan ke rancangan (Klik Simpan untuk menyimpan)`);
  };

  const handleRemoveStudent = (studentName: string) => {
    setDraftStudents(prev => prev.filter(s => s !== studentName));
    showToast('Siswa dihapus dari rancangan (Klik Simpan untuk menyimpan)');
  };

  const startEditStudent = (idx: number, name: string) => {
    setEditingStudentIndex(idx);
    setEditingStudentValue(name);
  };

  const handleSaveStudentEdit = (idx: number) => {
    const val = editingStudentValue.trim().toUpperCase();
    if (!val) return;
    
    // Check duplicate
    const otherStudents = draftStudents.filter((_, i) => i !== idx);
    if (otherStudents.includes(val)) {
      showToast('Siswa dengan nama tersebut sudah ada.');
      return;
    }
    
    setDraftStudents(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy.sort();
    });
    setEditingStudentIndex(null);
    setEditingStudentValue('');
    showToast('Nama siswa diperbarui di rancangan (Klik Simpan untuk menyimpan)');
  };

  const handleCancelStudentEdit = () => {
    setEditingStudentIndex(null);
    setEditingStudentValue('');
  };

  const handleSaveStudents = async () => {
    if (!selectedClass?.id) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'classes', selectedClass.id), {
        students: draftStudents
      });
      
      const updatedClassObj = { ...selectedClass, students: draftStudents };
      setSelectedClass(updatedClassObj);
      setClassesList(prev => prev.map(c => c.id === selectedClass.id ? updatedClassObj : c));
      showToast('Perubahan daftar siswa berhasil disimpan!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'classes');
    }
    setProcessing(false);
  };

  const handleCancelStudentChanges = () => {
    if (selectedClass) {
      setDraftStudents(selectedClass.students || []);
      setEditingStudentIndex(null);
      setEditingStudentValue('');
      showToast('Perubahan dibatalkan');
    }
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
                        <div className={`w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] shrink-0 border ${
                          isSelected 
                            ? 'bg-blue-600 text-white border-blue-600' 
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}>
                          {index + 1}
                        </div>
                        <span className={`text-sm font-bold ${isSelected ? 'text-blue-700 font-extrabold' : 'text-slate-800'}`}>
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
                Silakan pilih kelas di kolom sebelah kiri terlebih dahulu untuk menginput atau mengedit nama siswa.
              </p>
            </div>
          ) : (() => {
            const hasChanges = JSON.stringify(draftStudents) !== JSON.stringify(selectedClass.students || []);
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
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 border border-blue-200/50 text-blue-700 text-[9px] font-black uppercase tracking-wider">
                    {draftStudents.length} Siswa
                  </span>
                </div>

                {/* Input forms */}
                <div className="p-4 border-b border-slate-100 flex flex-col gap-3 shrink-0 bg-white">
                  {/* Single Student Add */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={studentInput}
                        onChange={(e) => setStudentInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
                        placeholder="Masukkan nama siswa (Contoh: BUDI SETIAWAN)..."
                        className="w-full px-3 py-1.5 pl-8 text-xs font-semibold bg-slate-50 border border-slate-350 rounded focus:ring-1 focus:ring-blue-500 focus:bg-white outline-none transition-all uppercase placeholder-slate-400"
                      />
                      <Users className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                    <button
                      onClick={handleAddStudent}
                      disabled={processing || !studentInput.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded text-[10px] font-bold uppercase transition-colors shrink-0 flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah</span>
                    </button>
                  </div>

                  {/* Bulk Import Toggle & Area */}
                  <div>
                    {!showBulk ? (
                      <button
                        onClick={() => setShowBulk(true)}
                        className="text-blue-600 hover:text-blue-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:underline"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Atau Impor banyak siswa sekaligus (Bulk Import)</span>
                      </button>
                    ) : (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-slate-50/55 border border-slate-200 rounded-lg p-3 flex flex-col gap-2.5"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">Impor Masal (1 Nama per Baris)</span>
                          <button onClick={() => setShowBulk(false)} className="text-slate-450 hover:text-slate-650">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <textarea
                          value={bulkInput}
                          onChange={(e) => setBulkInput(e.target.value)}
                          placeholder={"BUDI SETIAWAN\nANI SETYAWATI\nIMAM BISHRY NURYAYI"}
                          rows={3}
                          className="w-full p-2 text-xs bg-white border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none uppercase font-semibold text-slate-755 leading-relaxed placeholder-slate-400"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setShowBulk(false)}
                            className="px-2.5 py-1 text-[9px] font-bold uppercase text-slate-500 border border-slate-300 rounded hover:bg-slate-100 transition cursor-pointer"
                          >
                            Batal
                          </button>
                          <button
                            onClick={handleBulkImport}
                            disabled={processing || !bulkInput.trim()}
                            className="px-2.5 py-1 text-[9px] font-bold uppercase bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
                          >
                            Proses Impor
                          </button>
                        </div>
                      </motion.div>
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
                        placeholder="Cari nama siswa..."
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
                    const filtered = draftStudents.filter(name => name.toLowerCase().includes(searchStudent.toLowerCase()));

                    if (draftStudents.length === 0) {
                      return (
                        <div className="text-center py-16 text-slate-400">
                          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                          <span className="font-extrabold uppercase text-[10px] tracking-wider leading-relaxed block text-slate-400">
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
                        {filtered.map((studentName, idx) => {
                          const originalIndex = draftStudents.indexOf(studentName);
                          const isEditingThis = editingStudentIndex === originalIndex;

                          return (
                            <div
                              key={studentName + idx}
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
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveStudentEdit(originalIndex);
                                      if (e.key === 'Escape') handleCancelStudentEdit();
                                    }}
                                    className="flex-1 min-w-0 px-2 py-1 text-xs font-bold uppercase bg-slate-50 border border-blue-400 rounded outline-none focus:bg-white"
                                    autoFocus
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
                                    <span className="text-[9px] text-slate-400 group-hover/item:text-blue-500 font-bold bg-slate-50 w-5 h-5 rounded-full flex items-center justify-center border border-slate-100/50 shrink-0">
                                      {originalIndex + 1}
                                    </span>
                                    <span className="text-xs text-slate-700 font-extrabold uppercase tracking-tight truncate">
                                      {studentName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 opacity-90 group-hover/item:opacity-100 shrink-0">
                                    <button
                                      onClick={() => startEditStudent(originalIndex, studentName)}
                                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition cursor-pointer"
                                      title="Edit Nama Siswa"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveStudent(studentName)}
                                      className="p-1 text-slate-305 hover:text-red-500 hover:bg-red-50 rounded transition cursor-pointer"
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

                {/* Sticky Action Footer for student list saving */}
                <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                    {hasChanges ? (
                      <span className="text-amber-600 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        Ada perubahan (Klik Simpan)
                      </span>
                    ) : (
                      <span className="text-slate-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Data tersimpan di database
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleCancelStudentChanges}
                      disabled={processing || !hasChanges}
                      className="flex items-center space-x-1 px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 rounded-lg transition-colors text-xs font-bold cursor-pointer uppercase"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Batal</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveStudents}
                      disabled={processing || !hasChanges}
                      className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors text-xs font-bold cursor-pointer uppercase shadow-xs shrink-0"
                    >
                      {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      <span>Simpan</span>
                    </button>
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
    </div>
  );
}
