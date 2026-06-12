import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { 
  Users, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  FileSpreadsheet,
  MonitorPlay,
  BookOpen,
  Plus,
  Settings,
  ArrowRight,
  Sparkles,
  Search,
  Activity,
  Award,
  Calendar,
  Key,
  Copy,
  Check
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { StudentSession, Violation, Setting, Exam } from '../../types';

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Setting | null>(null);
  
  const [stats, setStats] = useState({
    activeStudents: 0,
    totalExams: 0,
    completedExams: 0,
    totalViolations: 0,
    totalSubjects: 0,
    totalClasses: 0
  });

  const [exams, setExams] = useState<Exam[]>([]);
  const [subjectsMap, setSubjectsMap] = useState<Record<string, string>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [activeSessions, setActiveSessions] = useState<StudentSession[]>([]);

  // Function to determine greeting based on Indonesian time
  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 11) return 'Selamat Pagi';
    if (hrs < 15) return 'Selamat Siang';
    if (hrs < 19) return 'Selamat Sore';
    return 'Selamat Malam';
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!user) return;
      try {
        // Fetch Settings Profile
        const profileSnap = await getDoc(doc(db, 'settings', user.uid));
        if (profileSnap.exists()) {
          setProfile(profileSnap.data() as Setting);
        }

        // Fetch Stats
        const [
          activeSnap, 
          examSnap, 
          completedSnap, 
          volSnap,
          subjSnap,
          classSnap
        ] = await Promise.all([
          getDocs(query(collection(db, 'student_sessions'), where('adminId', '==', user.uid), where('status', 'in', ['Aktif', 'Tidak Fokus', 'Melanggar']))),
          getDocs(query(collection(db, 'exams'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'student_sessions'), where('adminId', '==', user.uid), where('status', 'in', ['Selesai', 'Didiskualifikasi']))),
          getDocs(query(collection(db, 'violations'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'subjects'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'classes'), where('adminId', '==', user.uid)))
        ]);

        setStats({
          activeStudents: activeSnap.size,
          totalExams: examSnap.size,
          completedExams: completedSnap.size,
          totalViolations: volSnap.size,
          totalSubjects: subjSnap.size,
          totalClasses: classSnap.size
        });

        // Map subjects list to dictionary for quick subjectName resolution
        const subMap: Record<string, string> = {};
        subjSnap.docs.forEach(d => {
          const s = d.data();
          if (d.id && s.name) {
            subMap[d.id] = s?.name;
          }
        });
        setSubjectsMap(subMap);

        // Fetch and sort Exams list
        const examsList = examSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
        examsList.sort((a, b) => {
          if (a.isActive && !b.isActive) return -1;
          if (!a.isActive && b.isActive) return 1;
          return b.createdAt - a.createdAt;
        });
        setExams(examsList);

        // Safe Client-side sorting for Active Sessions
        const activeList = activeSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
        activeList.sort((a, b) => b.lastActivity - a.lastActivity);
        setActiveSessions(activeList.slice(0, 6));

      } catch (e) {
        console.error("Dashboard statistics loading issue:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user]);

  // Format Helper for relative time
  const formatTime = (timestamp: number) => {
    try {
      const elapsed = Date.now() - timestamp;
      const secs = Math.floor(elapsed / 1000);
      if (secs < 60) return 'Baru saja';
      const mins = Math.floor(secs / 60);
      if (mins < 60) return `${mins}m lalu`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}j lalu`;
      return new Date(timestamp).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const handleCopyToken = (token: string) => {
    try {
      navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch (e) {
      console.error('Failed to copy token:', e);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Dynamic Header Greeting panel */}
      <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-xs relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1 z-10">
          <div className="flex items-center gap-1.5 text-blue-600 font-extrabold text-[10px] uppercase tracking-widest">
            <Sparkles className="w-4 h-4" />
            <span>EXAM MONITOR HUB</span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">
            {getGreeting()}, {profile?.teacherName || user?.email?.split('@')[0] || 'Proktor'}
          </h2>
          <p className="text-xs text-slate-500 font-medium max-w-xl leading-relaxed">
            Selamat datang di panel kontrol ujian digital. Anda mengawasi <span className="font-bold text-slate-800">{profile?.schoolName || 'Institusi Anda'}</span>. Pantau kejujuran, kelola jadwal kelas, dan evaluasi hasil secara real-time.
          </p>
        </div>
        <div className="shrink-0 flex items-center md:justify-end gap-3 z-10">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Hari & Tanggal</div>
            <div className="text-xs font-extrabold text-slate-700 capitalize">
              {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
          <Link
            to="/admin/monitor"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-xs"
          >
            <MonitorPlay className="w-4 h-4 animate-pulse" />
            <span>Mulai Monitor</span>
          </Link>
        </div>
        <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-blue-50/20 to-transparent pointer-events-none" />
      </div>

      {/* Primary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Siswa Aktif */}
        <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-xs relative overflow-hidden transition-all hover:border-blue-300">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Siswa Aktif</span>
              <div className="text-2xl font-black text-slate-800 flex items-center gap-2">
                {stats.activeStudents}
                {stats.activeStudents > 0 && (
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-65"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                )}
              </div>
            </div>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3.5 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span>Daftar Kelas: {stats.totalClasses}</span>
            <Link to="/admin/monitor" className="text-blue-600 hover:underline flex items-center">
              Pantau <ArrowRight className="w-3 h-3 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Total Ujian */}
        <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-xs relative overflow-hidden transition-all hover:border-blue-300">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Total Ujian</span>
              <div className="text-2xl font-black text-slate-800">{stats.totalExams}</div>
            </div>
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3.5 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span>Mapel: {stats.totalSubjects} Terdaftar</span>
            <Link to="/admin/exams" className="text-blue-600 hover:underline flex items-center">
              Kelola <ArrowRight className="w-3 h-3 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Pelanggaran */}
        <div className={`p-4 border rounded-xl shadow-xs relative overflow-hidden transition-all hover:border-red-300 ${stats.totalViolations > 0 ? 'bg-red-50/10 border-red-200' : 'bg-white border-slate-200'}`}>
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider block">Pelanggaran</span>
              <div className="text-2xl font-black text-red-600">{stats.totalViolations}</div>
            </div>
            <div className="p-2.5 bg-red-100 text-red-600 rounded-lg animate-pulse">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3.5 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px] text-red-400 font-bold uppercase tracking-wider">
            <span>Siswa Curang Tercatat</span>
            <Link to="/admin/monitor" className="text-red-600 hover:underline flex items-center">
              Selidiki <ArrowRight className="w-3 h-3 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Ujian Selesai */}
        <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-xs relative overflow-hidden transition-all hover:border-blue-300">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Selesai Dikerjakan</span>
              <div className="text-2xl font-black text-slate-800">{stats.completedExams}</div>
            </div>
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
              <CheckCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3.5 pt-2 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span>Nilai Terkalkulasi</span>
            <Link to="/admin/results" className="text-indigo-600 hover:underline flex items-center">
              Laporan <ArrowRight className="w-3 h-3 ml-0.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Grid: Data feed on left, actions guidelines on right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column (List of Active & Violations) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Agenda & Status Token Ujian Panel */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-widest">
                  Status Token & Jadwal Ujian Terbaru
                </h3>
              </div>
              <span className="px-2 py-0.5 bg-blue-105 text-blue-700 text-[9px] font-black uppercase tracking-wider rounded">
                AGENDA
              </span>
            </div>
            
            <div className="divide-y divide-slate-150 max-h-[350px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Memuat data ujian...
                </div>
              ) : exams.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2.5 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-500">
                    Belum Ada Ujian Terjadwal
                  </span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">
                    Silakan tambahkan ujian baru untuk memulai pengerjaan CBT siswa
                  </span>
                  <Link 
                    to="/admin/exams" 
                    className="mt-3.5 inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Buat Ujian
                  </Link>
                </div>
              ) : (
                exams.slice(0, 5).map((ex, i) => {
                  const subjectName = subjectsMap[ex.subjectId] || 'Mata Pelajaran';
                  return (
                    <div key={ex.id || i} className="p-4 hover:bg-slate-50/50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider leading-none border ${
                            ex.isActive 
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                              : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}>
                            {ex.isActive ? 'AKTIF' : 'NONAKTIF'}
                          </span>
                          {ex.targetClass && (
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide">
                              Kelas {ex.targetClass}
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-tight mt-1 truncate">
                          {ex.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-450 font-semibold uppercase tracking-wide flex-wrap">
                          <span className="text-blue-600 font-bold">{subjectName}</span>
                          <span className="text-slate-300">•</span>
                          <span className="flex items-center gap-1 text-slate-500">
                            <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                            {ex.date}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-500">{ex.startTime} - {ex.endTime} ({ex.duration} Mins)</span>
                        </div>
                      </div>

                      {/* Token Section */}
                      <div className="shrink-0 flex items-center justify-end">
                        {ex.isActive ? (
                          <div className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 pl-2.5 flex items-center gap-2 shadow-3xs max-w-xs">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black tracking-wider text-slate-400 uppercase leading-none">RILIS TOKEN</span>
                              <span className="font-mono text-xs font-black tracking-widest text-slate-800 mt-0.5">{ex.activeToken}</span>
                            </div>
                            <button
                              onClick={() => handleCopyToken(ex.activeToken)}
                              className="p-1.5 hover:bg-slate-200/60 text-slate-500 hover:text-slate-705 rounded-md transition cursor-pointer"
                              title="Salin Token"
                            >
                              {copiedToken === ex.activeToken ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-450 font-bold uppercase tracking-wider italic">
                            Token Terkunci
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {exams.length > 5 && (
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex justify-center">
                <Link 
                  to="/admin/exams" 
                  className="text-[10px] uppercase font-black tracking-widest text-blue-600 hover:text-blue-700 flex items-center gap-1 transition"
                >
                  <span>Lihat Semua Ujian ({stats.totalExams})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>

          {/* Active Sessions Monitor Grid */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-widest">
                  Siswa Sedang Ujian (Real-time Hub)
                </h3>
              </div>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>

            <div className="p-4">
              {loading ? (
                <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-wider">
                  Memuat aktivitas siswa...
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-500">
                    Belum Ada Siswa Menjalani Ujian
                  </span>
                  <span className="text-[9px] text-slate-400 block mt-0.5">
                    Aktifkan ujian dan berikan token ke siswa agar mereka bisa masuk
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeSessions.map((s, idx) => (
                    <div 
                      key={s.id || idx} 
                      className="p-3 border border-slate-150/80 rounded-lg shadow-2xs hover:border-blue-200 transition bg-slate-50/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-800 uppercase tracking-tight block truncate">
                            {s.studentName}
                          </span>
                          <span className="text-[9.5px] font-bold text-slate-450 uppercase mt-0.5 block">
                            Kelas {s.className}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase tracking-wider border shrink-0 ${
                          s.status === 'Aktif' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                            : s.status === 'Tidak Fokus' 
                            ? 'bg-amber-50 text-amber-700 border-amber-200' 
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {s.status}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100/60 pt-2">
                        <span>Pelanggaran: <span className={s.violationsCount > 0 ? 'text-red-550 font-extrabold' : ''}>{s.violationsCount}</span></span>
                        <span>Aktif {formatTime(s.lastActivity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Quick shortcuts / Admin guidelines */}
        <div className="space-y-6">
          {/* Quick Shortcuts */}
          <div className="bg-white p-5 border border-slate-200 rounded-xl shadow-xs">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4">
              Akses Cepat Pengelola
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <Link 
                to="/admin/exams" 
                className="p-3.5 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-xl flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="p-2 bg-white rounded-lg border border-slate-150 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Plus className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-2.5 block text-slate-700 group-hover:text-blue-700">
                  Ujian Baru
                </span>
              </Link>
              
              <Link 
                to="/admin/classes" 
                className="p-3.5 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-xl flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="p-2 bg-white rounded-lg border border-slate-150 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Users className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-2.5 block text-slate-700 group-hover:text-blue-700">
                  Kelola Kelas
                </span>
              </Link>

              <Link 
                to="/admin/subjects" 
                className="p-3.5 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-xl flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="p-2 bg-white rounded-lg border border-slate-150 group-hover:bg-blue-600 group-hover:text-white transition">
                  <BookOpen className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-2.5 block text-slate-700 group-hover:text-blue-700">
                  Mata Pelajaran
                </span>
              </Link>

              <Link 
                to="/admin/settings" 
                className="p-3.5 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-xl flex flex-col items-center justify-center text-center transition group cursor-pointer"
              >
                <div className="p-2 bg-white rounded-lg border border-slate-150 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Settings className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider mt-2.5 block text-slate-700 group-hover:text-blue-700">
                  Pengaturan
                </span>
              </Link>
            </div>
          </div>

          {/* Quick Guide Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-xl shadow-md border border-slate-800">
            <div className="flex items-center space-x-2 text-blue-400 mb-3">
              <Award className="w-5 h-5" />
              <h4 className="text-xs font-black uppercase tracking-wider">Panduan Keamanan CBT</h4>
            </div>
            
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <span className="text-[11px] font-extrabold text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-900/40 shrink-0 mt-0.5">1</span>
                <div>
                  <span className="text-xs font-bold uppercase block tracking-tight">Kunci Layar Siswa</span>
                  <span className="text-[10px] text-slate-350 font-medium leading-relaxed mt-0.5 block">Siswa wajib menjalankan ujian dalam mode layar penuh (fullscreen). Peringatan otomatis akan muncul jika sistem mendeteksi upaya keluar dari halaman ujian.</span>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-[11px] font-extrabold text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-900/40 shrink-0 mt-0.5">2</span>
                <div>
                  <span className="text-xs font-bold uppercase block tracking-tight">Cegah Sesi Ganda</span>
                  <span className="text-[10px] text-slate-350 font-medium leading-relaxed mt-0.5 block">Sesi ujian dikunci secara khusus per perangkat untuk membatasi aktivitas masuk ganda (double login) pada peramban, tab, atau profil browser lain.</span>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-[11px] font-extrabold text-blue-400 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-900/40 shrink-0 mt-0.5">3</span>
                <div>
                  <span className="text-xs font-bold uppercase block tracking-tight">Diskualifikasi oleh Pengawas</span>
                  <span className="text-[10px] text-slate-350 font-medium leading-relaxed mt-0.5 block">Pengawas memiliki wewenang penuh untuk menggunakan fitur keluarkan (kick) atau diskualifikasi langsung dari halaman Monitoring Aktivitas peserta jika terbukti melanggar tata tertib.</span>
                </div>
              </li>
            </ul>

            <div className="mt-5 pt-3.5 border-t border-slate-700/60 flex justify-end">
              <Link 
                to="/admin/results" 
                className="text-white hover:text-blue-400 text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 transition"
              >
                <span>Lihat Laporan Rekap</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
