import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { Users, FileText, CheckCircle, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    activeStudents: 0,
    totalExams: 0,
    completedExams: 0,
    totalViolations: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      if (!user) return;
      try {
        const [activeSnap, examSnap, completedSnap, volSnap] = await Promise.all([
          getDocs(query(collection(db, 'student_sessions'), where('adminId', '==', user.uid), where('status', '==', 'Aktif'))),
          getDocs(query(collection(db, 'exams'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'student_sessions'), where('adminId', '==', user.uid), where('status', 'in', ['Selesai', 'Didiskualifikasi']))),
          getDocs(query(collection(db, 'violations'), where('adminId', '==', user.uid)))
        ]);

        setStats({
          activeStudents: activeSnap.size,
          totalExams: examSnap.size,
          completedExams: completedSnap.size,
          totalViolations: volSnap.size
        });
      } catch (e) {
        console.error(e);
      }
    };
    fetchStats();
  }, [user]);

  return (
    <div className="w-full space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Siswa Aktif</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.activeStudents}</div>
          <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase hover:text-blue-600"><Link to="/admin/monitor">Lihat Monitor &rarr;</Link></div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Ujian</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.totalExams}</div>
          <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase hover:text-blue-600"><Link to="/admin/exams">Kelola Ujian &rarr;</Link></div>
        </div>

        <div className="bg-white p-4 border border-red-100 rounded-lg shadow-sm relative overflow-hidden">
          <div className="text-xs text-red-500 font-medium">Pelanggaran</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{stats.totalViolations}</div>
          <div className="text-[10px] text-red-400 font-bold mt-1 uppercase hover:text-red-600"><Link to="/admin/monitor">Pantau Kasus &rarr;</Link></div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Ujian Selesai</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{stats.completedExams}</div>
          <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase hover:text-blue-600"><Link to="/admin/results">Lihat Laporan &rarr;</Link></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 flex flex-col items-center justify-center text-center min-h-[200px]">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">Panduan Pengawas</h3>
          <p className="text-[11px] text-slate-500 mb-4 max-w-sm">
            Gunakan Live Monitor untuk memantau aktivitas secara real-time. Anda dapat menegur atau mendiskualifikasi siswa yang ketahuan bertindak curang.
          </p>
          <Link to="/admin/monitor" className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">Buka Live Monitor</Link>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 flex flex-col items-center justify-center text-center min-h-[200px]">
          <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-3">
            <FileSpreadsheet className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">Export ke Excel</h3>
          <p className="text-[11px] text-slate-500 mb-4 max-w-sm">
            Sistem secara otomatis akan menggrading semua soal pilihan ganda. Anda bisa langsung mendownload rekap nilainya di halaman laporan.
          </p>
          <Link to="/admin/results" className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors">Buka Laporan</Link>
        </div>
      </div>
    </div>
  );
}
