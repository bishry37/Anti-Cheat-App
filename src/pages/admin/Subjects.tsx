import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, where } from 'firebase/firestore';
import { Subject } from '../../types';
import { Plus, Edit2, Trash2, Loader2, Save, X, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';

export default function Subjects() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
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
    if (user) fetchSubjects();
  }, [user]);

  const fetchSubjects = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'subjects'), where('adminId', '==', user.uid));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Subject));
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setSubjects(list);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!nameInput.trim() || !user) return;
    setProcessing(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'subjects', editingId), { name: nameInput.trim(), adminId: user.uid });
      } else {
        await addDoc(collection(db, 'subjects'), {
          name: nameInput.trim(),
          createdAt: Date.now(),
          adminId: user.uid
        });
      }
      setIsAdding(false);
      setEditingId(null);
      setNameInput('');
      await fetchSubjects();
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'subjects');
    }
    setProcessing(false);
  };

  const handleDelete = (id: string) => {
    setModalConfig({
      title: 'Hapus Mata Pelajaran',
      description: 'Apakah Anda yakin ingin menghapus mata pelajaran ini? Tindakan ini akan menghapus data tersebut secara permanen.',
      idToDelete: id
    });
  };

  const executeDelete = async () => {
    if (!modalConfig || !modalConfig.idToDelete) return;
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'subjects', modalConfig.idToDelete));
      setModalConfig(null);
      await fetchSubjects();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'subjects');
    }
    setProcessing(false);
  };

  const startEdit = (subject: Subject) => {
    setEditingId(subject.id!);
    setNameInput(subject.name);
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
            <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-3">{editingId ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran'}</h3>
            <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
              <input 
                type="text" 
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Nama Mata Pelajaran"
                className="flex-1 w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                autoFocus
              />
              <div className="flex space-x-1.5 w-full sm:w-auto">
                <button 
                  onClick={cancelEdit}
                  disabled={processing}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-1 px-3 py-1.5 border border-slate-300 text-slate-700 text-[11px] font-bold uppercase rounded hover:bg-slate-50 transition-colors"
                >
                  <X className="w-3 h-3" />
                  <span>Batal</span>
                </button>
                <button 
                  onClick={handleSave}
                  disabled={processing || !nameInput.trim()}
                  className="flex-1 sm:flex-none flex items-center justify-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50 transition-colors text-[11px] font-bold uppercase"
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
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Daftar Mata Pelajaran</h3>
          {!isAdding && (
            <button 
              onClick={() => setIsAdding(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-[10px] font-bold flex items-center space-x-1.5 uppercase transition-colors shadow-sm"
            >
              <Plus className="w-3 h-3" />
              <span>Tambah Mapel</span>
            </button>
          )}
        </div>
        
        <div className="overflow-auto flex-1 p-2">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : subjects.length === 0 ? (
          <div className="text-center p-12">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <BookOpen className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Belum ada mata pelajaran</h3>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50 flex flex-col space-y-1">
            {subjects.map((sub, index) => (
              <li key={sub.id} className="flex items-center justify-between p-2.5 rounded hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-[10px] shrink-0 border border-slate-200">
                    {index + 1}
                  </div>
                  <span className="font-semibold text-slate-800 text-sm">{sub.name}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <button 
                    onClick={() => startEdit(sub)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => handleDelete(sub.id!)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
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
