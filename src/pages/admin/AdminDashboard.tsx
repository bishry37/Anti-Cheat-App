import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, getDocs, where, doc, getDoc, onSnapshot } from 'firebase/firestore';
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
  Check,
  Clock
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
  const [currentTime, setCurrentTime] = useState(new Date());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = canvas.width = entry.contentRect.width;
        height = canvas.height = entry.contentRect.height;
      }
    });
    
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
      alpha: number;
    }

    const particles: Particle[] = [];
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 0.8,
        color: i % 2 === 0 ? '59, 130, 246' : '99, 102, 241', // blue / indigo RGB
        alpha: Math.random() * 0.35 + 0.15
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw subtle tech grids
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 30;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Update and draw particles
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around screen beautifully
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.fill();
      });

      // Draw subtle constellation lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 70) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            const alpha = (1 - dist / 70) * 0.12;
            ctx.strokeStyle = `rgba(147, 197, 253, ${alpha})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, []);

  // Function to determine greeting based on Indonesian time
  const getGreeting = () => {
    const hrs = new Date().getHours();
    if (hrs < 11) return 'Selamat Pagi';
    if (hrs < 15) return 'Selamat Siang';
    if (hrs < 19) return 'Selamat Sore';
    return 'Selamat Malam';
  };

  useEffect(() => {
    if (!user) return;

    let unsubscribeSessions: (() => void) | undefined;
    let unsubscribeViolations: (() => void) | undefined;

    const fetchDashboardData = async () => {
      try {
        // Fetch Settings Profile
        const profileSnap = await getDoc(doc(db, 'settings', user.uid));
        if (profileSnap.exists()) {
          setProfile(profileSnap.data() as Setting);
        }

        // Fetch Exam, Subject, and Class data
        const [
          examSnap, 
          subjSnap,
          classSnap
        ] = await Promise.all([
          getDocs(query(collection(db, 'exams'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'subjects'), where('adminId', '==', user.uid))),
          getDocs(query(collection(db, 'classes'), where('adminId', '==', user.uid)))
        ]);

        // Map subjects list to dictionary for quick subjectName resolution
        const subMap: Record<string, string> = {};
        subjSnap.docs.forEach(d => {
          const s = d.data();
          if (d.id && s.name) {
            subMap[d.id] = s.name;
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

        setStats(prev => ({
          ...prev,
          totalExams: examSnap.size,
          totalSubjects: subjSnap.size,
          totalClasses: classSnap.size
        }));

        // Now setup real-time listener for student sessions
        const sessionsQuery = query(
          collection(db, 'student_sessions'),
          where('adminId', '==', user.uid)
        );

        unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
          const allSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
          
          // Filter active (Aktif, Tidak Fokus, Melanggar)
          const activeList = allSessions.filter(
            s => ['Aktif', 'Tidak Fokus', 'Melanggar'].includes(s.status) && !s.hiddenFromMonitor
          );
          activeList.sort((a, b) => b.lastActivity - a.lastActivity);
          setActiveSessions(activeList);

          // Filter completed (Selesai, Didiskualifikasi)
          const completedList = allSessions.filter(
            s => ['Selesai', 'Didiskualifikasi'].includes(s.status)
          );

          setStats(prev => ({
            ...prev,
            activeStudents: activeList.length,
            completedExams: completedList.length
          }));
          setLoading(false);
        }, (err) => {
          console.error("Error watching sessions in real-time:", err);
          setLoading(false);
        });

        // Setup real-time listener for violations
        const violationsQuery = query(
          collection(db, 'violations'),
          where('adminId', '==', user.uid)
        );

        unsubscribeViolations = onSnapshot(violationsQuery, (snapshot) => {
          setStats(prev => ({
            ...prev,
            totalViolations: snapshot.size
          }));
        }, (err) => {
          console.error("Error watching violations in real-time:", err);
        });

      } catch (e) {
        console.error("Dashboard statistics loading issue:", e);
        setLoading(false);
      }
    };

    fetchDashboardData();

    return () => {
      if (unsubscribeSessions) unsubscribeSessions();
      if (unsubscribeViolations) unsubscribeViolations();
    };
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
      {/* Top Banner: Greeting & Realtime Clock Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Welcome Greeting Card (Left) */}
        <div className="lg:col-span-7 bg-gradient-to-br from-white via-slate-50 to-slate-100/80 border border-slate-200 rounded-2xl p-6 shadow-xs relative overflow-hidden flex flex-col justify-between">
          {/* Soft glowing ambient spots in corners */}
          <div className="absolute -top-10 -left-10 w-32 h-32 bg-blue-300/10 rounded-full blur-2xl pointer-events-none" />
          <div className="absolute -bottom-10 -right-10 w-28 h-28 bg-indigo-300/10 rounded-full blur-2xl pointer-events-none" />
          
          <div className="space-y-2 z-10">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-650"></span>
              </span>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                Monitoring CBT Hub
              </span>
            </div>
            
            <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-tight">
              {getGreeting()}, <span className="text-blue-600">{profile?.teacherName || user?.email?.split('@')[0] || 'Proktor'}</span>
            </h1>
            
            <p className="text-slate-500 font-medium text-xs leading-relaxed max-w-lg">
              Selamat bertugas! Panel kontrol pengawasan ujian digital ini terhubung langsung dengan sistem keamanan Exam Pro Plus. Anda mengawasi <span className="font-extrabold text-slate-700">{profile?.schoolName || 'Institusi Anda'}</span>.
            </p>
          </div>
          
          {/* Active Status Banner */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-4 z-10">
            <div className="flex items-center gap-3">
              <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl shrink-0">
                <Users className="w-5 h-5 shrink-0" />
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Total Siswa Aktif</span>
                <span className="text-base font-black text-slate-800 flex items-center gap-1.5 leading-none">
                  {stats.activeStudents} <span className="text-xs font-semibold text-slate-400">Siswa Berlangsung</span>
                </span>
              </div>
            </div>
            <Link 
              to="/admin/monitor" 
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider px-3.5 py-2 rounded-xl transition duration-150 flex items-center gap-1 shrink-0"
            >
              <span>Pantau Real-time</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-blue-50/15 to-transparent pointer-events-none" />
        </div>

        {/* Real-time Jam, Hari, Tanggal Widget (Right) with Live Wallpaper */}
        <div className="lg:col-span-5 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 border border-slate-800 p-6 rounded-2xl shadow-lg relative overflow-hidden flex flex-col justify-between text-white min-h-[190px]">
          {/* Live Canvas Wallpaper wrapper */}
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-80" />
          
          {/* Subtle glowing ambient blobs */}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/15 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />
          <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDuration: '10s' }} />

          <div className="flex items-center justify-between z-10">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-400 shrink-0" />
              JAM & TANGGAL SERVER
            </span>
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[8px] font-bold text-slate-400 tracking-wider font-mono">SECURE SYNC</span>
            </div>
          </div>

          <div className="my-3 z-10">
            {/* Big Beautiful Digital Clock */}
            <div className="font-mono text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-100 via-indigo-100 to-indigo-200 tracking-tight leading-none">
              {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
            {/* Elegant formatted Indonesian date */}
            <div className="text-xs sm:text-sm font-semibold text-slate-300 tracking-wide mt-2 block capitalize">
              {currentTime.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>

          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider pt-2 border-t border-slate-800/60 flex items-center justify-between z-10">
            <span>Zona Waktu: GMT+7 (WIB)</span>
            <span className="text-blue-400 font-extrabold hover:underline cursor-default">Proktor Realtime</span>
          </div>
        </div>

      </div>

      {/* Main Grid: Left Column is active exam / list, Right Column is stats summary & action buttons */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Active Exam and Tokens Container (Left - Col Span 8) */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Active Exams Card */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg">
                  <Activity className="w-4 h-4 shrink-0" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    Informasi Ujian Aktif & Rilis Token
                  </h2>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mt-0.5">
                    Token ini digunakan siswa untuk masuk pengerjaan soal
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 bg-rose-50 text-rose-700 text-[8.5px] font-black uppercase tracking-wider rounded-lg border border-rose-100 animate-pulse">
                LIVE STATUS
              </span>
            </div>

            <div className="p-5 space-y-4">
              {loading ? (
                <div className="text-center py-12 text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                  Sinkronisasi Ujian CBT...
                </div>
              ) : exams.filter(ex => ex.isActive).length === 0 ? (
                /* Sleek Empty State for Active Exams */
                <div className="text-center py-10 px-4">
                  <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-3.5 text-slate-405">
                    <Key className="w-6 h-6 text-slate-400 shrink-0" />
                  </div>
                  <span className="text-[11px] font-black text-slate-850 uppercase tracking-widest block">
                    Tidak ada ujian yang sedang aktif
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-1 leading-relaxed max-w-sm mx-auto">
                    Token hanya dirilis pada ujian yang telah di-aktifkan oleh Proktor. Aktifkan atau buat ujian baru melalui menu Kelola Ujian.
                  </span>
                  <Link 
                    to="/admin/exams"
                    className="mt-4 inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Kelola & Aktifkan Ujian</span>
                  </Link>
                </div>
              ) : (
                /* Render each Active Exam */
                <div className="space-y-4">
                  {exams.filter(ex => ex.isActive).map((ex, i) => {
                    const subjectName = subjectsMap[ex.subjectId] || 'Mata Pelajaran';
                    const activeInThisExam = activeSessions.filter(s => s.examId === ex.id && ['Aktif', 'Tidak Fokus', 'Melanggar'].includes(s.status)).length;
                    
                    return (
                      <div 
                        key={ex.id || i} 
                        className="bg-slate-50/50 hover:bg-slate-50 border border-slate-150 rounded-2xl p-5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-2 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200/50 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider">
                              Kelas {ex.targetClass}
                            </span>
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg font-extrabold text-[9px] uppercase tracking-wide border border-blue-105">
                              {subjectName}
                            </span>
                          </div>
                          <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-tight mt-1 truncate">
                            {ex.title}
                          </h4>
                          
                          <div className="flex items-center gap-3 text-[10px] text-slate-450 font-bold uppercase tracking-wider flex-wrap pt-0.5">
                            <span className="flex items-center gap-1 text-slate-500">
                              <Users className="w-3.5 h-3.5 text-slate-450 shrink-0" />
                              {activeInThisExam} Siswa Sedang Mengerjakan
                            </span>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500">Sisa Durasi {ex.duration} Mnt</span>
                          </div>
                        </div>

                        {/* Highly optimized Token Box */}
                        <div className="shrink-0 flex items-center">
                          <div className="bg-white border hover:border-blue-500/40 rounded-xl p-2 px-3 flex items-center gap-4 transition shadow-2xs">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black tracking-widest text-blue-500 uppercase leading-none">RILIS TOKEN</span>
                              <span className="font-mono text-base font-black tracking-widest text-slate-800 mt-1 leading-none">
                                {ex.activeToken}
                              </span>
                            </div>
                            <button
                              onClick={() => handleCopyToken(ex.activeToken)}
                              className="p-2 hover:bg-blue-50 text-slate-500 hover:text-blue-600 rounded-lg transition shrink-0 cursor-pointer"
                              title="Salin Token"
                            >
                              {copiedToken === ex.activeToken ? (
                                <Check className="w-4 h-4 text-emerald-650" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* List of Recent Students taking exams */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="bg-slate-50 text-slate-600 p-1.5 rounded-lg border border-slate-200/50">
                  <Users className="w-4 h-4 shrink-0" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    Siswa Sedang Ujian Terbaru
                  </h3>
                  <p className="text-[10px] text-slate-450 font-medium uppercase tracking-wide mt-0.5">
                    Memantau kehadiran dan integritas pengerjaan siswa
                  </p>
                </div>
              </div>
              <Link 
                to="/admin/monitor" 
                className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 flex items-center gap-1 transition"
              >
                <span>Siswa Aktif ({stats.activeStudents})</span>
                <ArrowRight className="w-3.5 h-3.5 animate-pulse" />
              </Link>
            </div>

            <div className="p-5">
              {loading ? (
                <div className="text-center py-6 text-slate-400 text-xs font-bold uppercase tracking-wider animate-pulse">
                  Sedang memuat data sesi...
                </div>
              ) : activeSessions.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-500">
                    Belum ada siswa yang terkoneksi
                  </span>
                  <span className="text-[9px] text-slate-450 block mt-0.5">
                    Data aktivitas akan langsung muncul setelah siswa menggunakan token masuk ujian.
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeSessions.slice(0, 6).map((s, idx) => (
                    <div 
                      key={s.id || idx} 
                      className="p-3 border border-slate-200 rounded-xl shadow-3xs bg-slate-50/10 hover:border-slate-300 transition-all flex flex-col justify-between"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-xs font-black text-slate-800 uppercase tracking-tight block truncate">
                            {s.studentName}
                          </span>
                          <span className="text-[9.5px] font-bold text-slate-450 uppercase mt-0.5 block">
                            Kelas {s.className}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider border shrink-0 ${
                          s.status === 'Aktif' 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/50' 
                            : s.status === 'Tidak Fokus' 
                            ? 'bg-amber-50 text-amber-700 border-amber-200' 
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {s.status}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-450 border-t border-slate-100/60 pt-2 shrink-0">
                        <span>Pelanggaran: <span className={s.violationsCount > 0 ? 'text-red-550 font-extrabold' : 'text-slate-500'}>{s.violationsCount}</span></span>
                        <span>Aktif {formatTime(s.lastActivity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right Columns: Admin shortcuts and Overview (Col Span 4) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Quick Shortcuts Bento Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-4">
              Menu Akses Cepat
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              
              <Link 
                to="/admin/exams" 
                className="p-4 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
              >
                <div className="p-2.5 bg-white rounded-xl border border-slate-150 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition duration-150">
                  <Plus className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider mt-3 block text-slate-700 group-hover:text-blue-700">
                  Buat Ujian
                </span>
              </Link>
              
              <Link 
                to="/admin/monitor" 
                className="p-4 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
              >
                <div className="p-2.5 bg-white rounded-xl border border-slate-150 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition duration-150">
                  <MonitorPlay className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider mt-3 block text-slate-700 group-hover:text-blue-700">
                  Monitor Live
                </span>
              </Link>

              <Link 
                to="/admin/classes" 
                className="p-4 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
              >
                <div className="p-2.5 bg-white rounded-xl border border-slate-150 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition duration-150">
                  <Users className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider mt-3 block text-slate-700 group-hover:text-blue-700">
                  Data Kelas
                </span>
              </Link>

              <Link 
                to="/admin/subjects" 
                className="p-4 bg-slate-50 hover:bg-blue-50/40 hover:text-blue-700 border border-slate-200/80 rounded-2xl flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
              >
                <div className="p-2.5 bg-white rounded-xl border border-slate-150 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition duration-150">
                  <BookOpen className="w-4 h-4 text-slate-650 group-hover:text-white" />
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider mt-3 block text-slate-700 group-hover:text-blue-700">
                  Mapel Ujian
                </span>
              </Link>

            </div>
          </div>

          {/* Informasi Dasar Institusi */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">
              Informasi Data Institusi
            </h3>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50/40 border border-slate-150/50">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-slate-100 text-slate-600 rounded-lg">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-650 uppercase tracking-wide">
                      Nama Institusi
                    </span>
                    <span className="text-xs font-black text-slate-800">
                      {profile?.schoolName || '-'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50/40 border border-slate-150/50">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-650 uppercase tracking-wide">
                      Total Mata Pelajaran
                    </span>
                    <span className="text-xs font-black text-slate-800">
                      {stats.totalSubjects}
                    </span>
                  </div>
                </div>
                <Link to="/admin/subjects" className="text-blue-600 text-[10px] font-bold hover:underline">
                  Lihat
                </Link>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50/40 border border-slate-150/50">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-650 uppercase tracking-wide">
                      Total Data Kelas
                    </span>
                    <span className="text-xs font-black text-slate-800">
                      {stats.totalClasses}
                    </span>
                  </div>
                </div>
                <Link to="/admin/classes" className="text-blue-600 text-[10px] font-bold hover:underline">
                  Lihat
                </Link>
              </div>
            </div>
          </div>

          {/* Guidelines on Cheat Prevention */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-md border border-slate-800">
            <div className="flex items-center space-x-2 text-blue-400 mb-3">
              <Award className="w-5 h-5 shrink-0" />
              <h4 className="text-xs font-black uppercase tracking-wider">Keamanan CBT Proktor</h4>
            </div>
            
            <ul className="space-y-3 text-[10.5px] text-slate-300 font-medium leading-relaxed">
              <li className="flex items-start gap-2 border-b border-slate-800/60 pb-2">
                <span className="text-blue-400 font-bold">1.</span>
                <span>Siswa harus masuk ke mode fullscreen (layar penuh) untuk memulai pengerjaan.</span>
              </li>
              <li className="flex items-start gap-2 border-b border-slate-800/60 pb-2">
                <span className="text-blue-400 font-bold">2.</span>
                <span>Pindah tab, meminimalkan layar, atau membuka aplikasi lain otomatis mencatat pelanggaran.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 font-bold">3.</span>
                <span>Jika siswa melebihi batas toleransi pelanggaran, sistem otomatis mendiskualifikasi siswa tersebut.</span>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
}
