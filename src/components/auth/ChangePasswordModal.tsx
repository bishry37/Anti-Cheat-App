import React, { useState } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import PasswordChangeForm from './PasswordChangeForm';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Ganti Password</h3>
          <button onClick={() => { setError(null); setSuccess(null); onClose(); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
           {error && (
             <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start gap-2">
               <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
               <p>{error}</p>
             </div>
           )}
           {success && (
             <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm flex items-start gap-2">
               <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
               <p>{success}</p>
             </div>
           )}
           <PasswordChangeForm 
              onSuccess={() => {
                setSuccess('Password berhasil diperbarui');
                setError(null);
                setTimeout(onClose, 2000);
              }}
              onError={(err) => {
                setError(err);
                setSuccess(null);
              }}
           />
        </div>
      </div>
    </div>
  );
}
