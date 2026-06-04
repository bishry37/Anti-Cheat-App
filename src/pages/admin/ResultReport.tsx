import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, orderBy, where, doc, deleteDoc } from 'firebase/firestore';
import { StudentSession, Exam, Subject } from '../../types';
import { Loader2, Download, FileSpreadsheet, FileBarChart, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function ResultReport() {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [exams, setExams] = useState<Record<string, Exam>>({});
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState<string>('');

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

  useEffect(() => {
    fetchExams();
  }, []);

  useEffect(() => {
    fetchResults();
  }, [filterExam]);

  const fetchExams = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'exams'), orderBy('createdAt', 'desc')));
      const map: Record<string, Exam> = {};
      snap.forEach(d => map[d.id] = d.data() as Exam);
      setExams(map);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchResults = async () => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'student_sessions'), 
        where('status', 'in', ['Selesai', 'Didiskualifikasi'])
      );
      if (filterExam) {
         q = query(q, where('examId', '==', filterExam));
      }
      const snap = await getDocs(q);
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
      // Manual sort since compound index might fail without setup
      data.sort((a,b) => b.endTime! - a.endTime!);
      if (filterExam) {
        data = data.filter(d => d.examId === filterExam);
      }
      setSessions(data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleExportExcel = () => {
    const data = sessions.map((s, i) => ({
      No: i + 1,
      NamaSiswa: s.studentName,
      Kelas: s.className,
      Ujian: exams[s.examId]?.title || 'Ujian Terhapus',
      Status: s.status,
      Nilai: s.score?.toFixed(2) || '0',
      Benar: s.correctCount || 0,
      Salah: s.wrongCount || 0,
      Pelanggaran: s.violationsCount,
      WaktuMulai: new Date(s.startTime).toLocaleString(),
      WaktuSelesai: s.endTime ? new Date(s.endTime).toLocaleString() : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hasil Ujian');
    XLSX.writeFile(wb, `Hasil_Ujian_${new Date().getTime()}.xlsx`);
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
      showToast('Hasil ujian berhasil dihapus');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'student_sessions');
    }
  };

  return (
    <div className="w-full flex-1 flex flex-col h-full min-h-0">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Hasil & Laporan</h3>
          <div className="flex items-center space-x-2">
             <select
               value={filterExam}
               onChange={e => setFilterExam(e.target.value)}
               className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-bold uppercase focus:ring-1 focus:ring-blue-500 outline-none"
             >
               <option value="">Semua Ujian</option>
               {(Object.entries(exams) as [string, Exam][]).map(([id, ex]) => (
                 <option key={id} value={id}>{ex.title}</option>
               ))}
             </select>
             <button 
               disabled={sessions.length === 0}
               onClick={handleExportExcel}
               className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors text-[10px] font-bold uppercase shadow-sm disabled:opacity-50"
             >
               <FileSpreadsheet className="w-3.5 h-3.5" />
               <span>Export Excel</span>
             </button>
          </div>
        </div>

        <div className="overflow-auto flex-1 p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-b border-slate-100 sticky top-0 z-10">
                <th className="px-4 py-2 w-10">No</th>
                <th className="px-4 py-2">Peserta</th>
                <th className="px-4 py-2">Ujian</th>
                <th className="px-4 py-2 text-center">Nilai</th>
                <th className="px-4 py-2 text-center">Benar/Salah</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Memuat data...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500 font-bold">
                    Belum ada hasil ujian.
                  </td>
                </tr>
              ) : (
                sessions.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-800">{s.studentName}</div>
                      <div className="text-[10px] text-slate-500">Kelas {s.className}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-700">{exams[s.examId]?.title || '-'}</div>
                      <div className="text-[10px] text-slate-500">{new Date(s.endTime || 0).toLocaleDateString()}</div>
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
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${s.status === 'Didiskualifikasi' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right mr-0.5">
                      <button onClick={() => triggerDelete(s.id!, s.studentName)} className="px-2 py-1 rounded text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 flex items-center justify-center gap-1 ml-auto w-max transition-colors" title="Hapus Hasil">
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
    </div>
  );
}
