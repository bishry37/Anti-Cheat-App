import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, Database, BookOpen, Users, MonitorPlay, AlertTriangle, FileBarChart, Settings, LogOut, ShieldCheck, UserCircle, Menu, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { Setting } from '../../types';
import brandLogo from '../../assets/images/logo.jpg';
import ChangePasswordModal from '../auth/ChangePasswordModal';

export default function AdminLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Listen to settings changes in real-time
    const unsubProductSettings = onSnapshot(doc(db, 'settings', user.uid), (snap) => {
      if (snap.exists()) {
        setSetting(snap.data() as Setting);
      }
    }, (err) => {
      console.error('Error fetching settings:', err);
    });

    return () => unsubProductSettings();
  }, [user]);

  const handleLogout = async () => {
    await logout();
  };

  const menuItems = [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'Manajemen Ujian', path: '/admin/exams', icon: FileText },
    { name: 'Manajemen Kelas', path: '/admin/classes', icon: Users },
    { name: 'Bank Soal', path: '/admin/questions', icon: Database },
    { name: 'Mata Pelajaran', path: '/admin/subjects', icon: BookOpen },
    { name: 'Monitoring Peserta', path: '/admin/monitor', icon: MonitorPlay },
    { name: 'Hasil Ujian', path: '/admin/results', icon: FileBarChart },
    { name: 'Pengaturan', path: '/admin/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans relative">
      {/* Mobile Drawer Sidebar */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Overlay background */}
          <div 
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Menu Drawer contents */}
          <aside className="relative w-64 max-w-xs bg-slate-900 text-slate-300 flex flex-col h-full shadow-2xl z-50 animate-in slide-in-from-left duration-200">
        <div className="p-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center shrink-0 overflow-hidden bg-white/10 rounded-xl p-1.5">
              <img src={setting?.schoolLogo || brandLogo} alt={setting?.schoolName || "SYSTEM"} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
            </div>
            <h1 className="text-sm font-bold text-white tracking-widest uppercase leading-tight">
              {setting?.schoolName || 'ANTI CHEATING APP'}
            </h1>
          </div>
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
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
                    onClick={() => setIsMobileMenuOpen(false)}
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

            <div className="mt-auto p-4 border-t border-slate-800 shrink-0 bg-slate-800/30">
              <div className="flex items-center gap-3 px-2 pt-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors p-2" onClick={() => setIsPasswordModalOpen(true)}>
                {setting?.teacherPhoto ? (
                  <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border border-slate-600">
                    <img src={setting.teacherPhoto} alt="Profil" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {setting?.teacherName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'A'}
                  </div>
                )}
                <div className="text-sm overflow-hidden flex-1">
                  <div className="font-medium text-white break-words line-clamp-2 leading-tight">{setting?.teacherName || user?.displayName || 'Admin'}</div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">{setting?.teacherRole || user?.email}</div>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col hidden lg:flex shrink-0">
        <div className="p-6 flex flex-col items-center text-center gap-3 border-b border-slate-800 shrink-0">
          <div className="w-16 h-16 flex items-center justify-center shrink-0 overflow-hidden bg-white/10 rounded-2xl p-2">
            <img src={setting?.schoolLogo || brandLogo} alt={setting?.schoolName || "SYSTEM"} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-sm font-bold text-white tracking-widest leading-tight uppercase">
            {setting?.schoolName || 'ANTI CHEATING APP'}
          </h1>
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

        <div className="mt-auto p-4 border-t border-slate-800 shrink-0 bg-slate-800/30">
          <div className="flex items-center gap-3 px-2 pt-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors p-2" onClick={() => setIsPasswordModalOpen(true)}>
            {setting?.teacherPhoto ? (
              <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border border-slate-600">
                <img src={setting.teacherPhoto} alt="Profil" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                {setting?.teacherName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'A'}
              </div>
            )}
            <div className="text-sm overflow-hidden flex-1">
              <div className="font-medium text-white break-words line-clamp-2 leading-tight">{setting?.teacherName || user?.displayName || 'Admin'}</div>
              <div className="text-xs text-slate-400 truncate mt-0.5">{setting?.teacherRole || user?.email}</div>
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
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 font-sans">
          <div className="flex items-center gap-4">
            {/* Hamburger Button for mobile */}
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              title="Buka Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider hidden lg:block">Dashboard Admin</h2>
            <div className="lg:hidden flex items-center">
               <div className="w-11 h-11 flex items-center justify-center mr-3 shrink-0 bg-slate-100 rounded-xl p-1.5">
                  <img src={setting?.schoolLogo || brandLogo} alt={setting?.schoolName || "SYSTEM"} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
               </div>
               <span className="font-bold text-slate-800 tracking-widest text-[10px] uppercase leading-tight">
                 {setting?.schoolName || 'ANTI CHEATING APP'}
               </span>
            </div>
            <span className="hidden lg:inline-flex px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase tracking-wider">System Active</span>
          </div>

          {/* Mobile Profile Indicator */}
          <div className="lg:hidden flex items-center">
            {setting?.teacherPhoto ? (
              <div className="w-7 h-7 rounded-full overflow-hidden border border-slate-200 shadow-xs">
                <img src={setting.teacherPhoto} alt="Profil" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 shadow-xs">
                {setting?.teacherName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'A'}
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          <Outlet />
        </div>
      </main>
      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </div>
  );
}
