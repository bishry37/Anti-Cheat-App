import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, orderBy, where } from 'firebase/firestore';
import { StudentSession, Exam, Subject } from '../../types';
import { Loader2, Download, FileSpreadsheet, FileBarChart } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function ResultReport() {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [exams, setExams] = useState<Record<string, Exam>>({});
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState<string>('');

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
              </tr>
            </thead>
            <tbody className="text-xs divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Memuat data...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500 font-bold">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
