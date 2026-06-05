import React, { useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface PasswordChangeFormProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export default function PasswordChangeForm({ onSuccess, onError }: PasswordChangeFormProps) {
  const { changePassword, reauthenticate, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      onError?.('Password baru dan konfirmasi password tidak cocok');
      return;
    }
    if (newPassword.length < 6) {
      onError?.('Password harus minimal 6 karakter');
      return;
    }
    setChangingPassword(true);
    try {
      // Reauthenticate first to verify the old password and update session state
      await reauthenticate(currentPassword);
      await changePassword(newPassword);

      onSuccess?.();
      setNewPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
    } catch (err: any) {
      console.error("Change Password Error Details:", err);
      let errorMsg = 'Gagal memperbarui password.';
      // Check for common firebase auth error codes for incorrect password
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        errorMsg = 'Password saat ini salah.';
      } else if (err.code === 'auth/requires-recent-login') {
         errorMsg = 'Silakan login kembali untuk keamanan.';
      } else if (err.message) {
         errorMsg = err.message;
      }
      onError?.(errorMsg);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Password Saat Ini</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md focus:ring-1 focus:ring-blue-500 outline-none text-sm text-white"
          placeholder="Password saat ini"
          required
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Password Baru</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md focus:ring-1 focus:ring-blue-500 outline-none text-sm text-white"
          placeholder="Minimal 6 karakter"
          required
        />
      </div>
      <div>
        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Konfirmasi</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-md focus:ring-1 focus:ring-blue-500 outline-none text-sm text-white"
          placeholder="Ulangi password"
          required
        />
      </div>
      <button 
        type="submit" 
        disabled={changingPassword || !newPassword || !confirmPassword || !currentPassword} 
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-md flex items-center justify-center gap-2 transition-colors font-semibold disabled:opacity-50 text-xs mt-2"
      >
        {changingPassword ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
        <span>Update Password</span>
      </button>
    </form>
  );
}
