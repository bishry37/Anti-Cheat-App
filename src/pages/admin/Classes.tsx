import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, where, writeBatch } from 'firebase/firestore';
import { Class } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, Users } from 'lucide-react';
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
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setClassesList(list);
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
        const oldClass = classesList.find(c => c.id === editingId);
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
      } else {
        await addDoc(collection(db, 'classes'), {
          name: newName,
          createdAt: Date.now(),
          adminId: user.uid
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
      const oldClass = classesList.find(c => c.id === modalConfig.idToDelete);
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

  return (
    <div className="w-full flex-1 flex flex-col h-full min-h-0">
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm overflow-hidden shrink-0"
          >
            <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-3">{editingId ? 'Edit Kelas' : 'Tambah Kelas'}</h3>
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
              <input 
                type="text" 
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Nama Kelas"
                className="flex-1 w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                autoFocus
              />
              <div className="flex space-x-1.5 w-full sm:w-auto">
                <button 
                  onClick={cancelEdit}
                  disabled={processing}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-1 px-3 py-1.5 border border-slate-300 text-slate-700 text-[11px] font-bold uppercase rounded hover:bg-slate-50 transition-colors cursor-pointer text-center"
                >
                  <X className="w-3 h-3" />
                  <span>Batal</span>
                </button>
                <button 
                  onClick={handleSave}
                  disabled={processing || !nameInput.trim()}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50 transition-colors text-[11px] font-bold cursor-pointer text-center uppercase"
                >
                  {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  <span>Simpan</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0">
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
            {classesList.map((classData, index) => (
              <li key={classData.id} className="flex items-center justify-between p-2.5 rounded hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-[10px] shrink-0 border border-slate-200">
                    {index + 1}
                  </div>
                  <span className="font-semibold text-slate-800 text-sm">{classData.name}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <button 
                    onClick={() => startEdit(classData)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors cursor-pointer text-center"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => handleDelete(classData.id!)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer text-center"
                    title="Hapus"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>

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
