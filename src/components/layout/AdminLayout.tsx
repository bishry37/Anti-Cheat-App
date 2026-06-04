import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, Database, BookOpen, MonitorPlay, AlertTriangle, FileBarChart, Settings, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export default function AdminLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
  };

  const menuItems = [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'Manajemen Ujian', path: '/admin/exams', icon: FileText },
    { name: 'Bank Soal', path: '/admin/questions', icon: Database },
    { name: 'Mata Pelajaran', path: '/admin/subjects', icon: BookOpen },
    { name: 'Monitoring Peserta', path: '/admin/monitor', icon: MonitorPlay },
    { name: 'Hasil & Laporan', path: '/admin/results', icon: FileBarChart },
    { name: 'Pengaturan Sekolah', path: '/admin/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col hidden md:flex shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800 shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold text-white shrink-0">EG</div>
          <h1 className="text-xl font-bold text-white tracking-tight">ExamGuard</h1>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold px-3 mb-2">Menu Utama</div>
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive 
                    ? 'bg-blue-600 text-white' 
                    : 'hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-slate-800 shrink-0">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user?.email?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="truncate text-sm">
              <div className="font-medium text-white truncate">{user?.displayName || 'Admin'}</div>
              <div className="text-xs text-slate-500 truncate">{user?.email}</div>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-400 hover:bg-slate-800 rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Placeholder / Mobile Header */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider hidden md:block">Dashboard Admin</h2>
            <div className="md:hidden flex items-center">
               <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center font-bold text-white text-xs mr-2">EG</div>
               <span className="font-bold text-slate-800 tracking-tight">ExamGuard</span>
            </div>
            <span className="hidden md:inline-flex px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase tracking-wider">System Active</span>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
