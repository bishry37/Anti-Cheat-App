import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType, storage } from '../../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Setting } from '../../types';
import { Save, Loader2, AlertCircle, Shield, Upload, X, CheckCircle2, Info, Trash2 } from 'lucide-react';

// Help compress and resize image to fit in Firestore 1MB limits safely if Storage fails
const compressAndResizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Gagal membuat canvas 2D'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Compress with solid JPEG compression (0.8 quality handles text/icons nicely and keeps size very low)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl);
      };
      img.onerror = (err) => {
        reject(err);
      };
    };
    reader.onerror = (err) => {
      reject(err);
    };
  });
};

interface ToastMessage {
  text: string;
  type: 'success' | 'error' | 'info';
}

export default function Settings() {
  const [setting, setSetting] = useState<Setting>({
    schoolName: '',
    schoolLogo: '',
    schoolAddress: '',
    schoolSlogan: '',
    motivationText: '',
    teacherPhoto: '',
    maxViolations: 3,
    updatedAt: Date.now()
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const DEFAULT_DOC_ID = 'school';

  const triggerToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const docRef = doc(db, 'settings', DEFAULT_DOC_ID);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setSetting(docSnap.data() as Setting);
        }
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    }
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSetting(prev => ({
      ...prev,
      [name]: name === 'maxViolations' ? parseInt(value) || 0 : value
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      triggerToast('File harus berupa berkas gambar', 'error');
      return;
    }

    try {
      setUploadingLogo(true);
      triggerToast('Mengupload Logo...', 'info');
      
      console.log('Starting upload for logo:', file.name);

      // 1. Optimize and compress image to a highly lightweight JPEG Data URL (Base64)
      let compressedDataUrl = '';
      try {
        compressedDataUrl = await compressAndResizeImage(file, 400, 400);
      } catch (compressErr) {
        console.error('Failed to compress image:', compressErr);
      }

      // Convert compressed Base64 back to a blob to upload to Firebase Storage if possible
      let uploadBlob: Blob | File = file;
      if (compressedDataUrl) {
        try {
          const response = await fetch(compressedDataUrl);
          uploadBlob = await response.blob();
        } catch (fetchErr) {
          console.error('Failed to convert base64 to blob:', fetchErr);
        }
      }

      const storageRef = ref(storage, `settings/logo_${Date.now()}_${file.name}`);
      
      // 2. Attempt to upload bytes to Firebase Storage with a short (4 seconds) fallback timeout
      const uploadPromise = uploadBytes(storageRef, uploadBlob);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Firebase Storage timeout')), 4000)
      );

      try {
        await Promise.race([uploadPromise, timeoutPromise]);
        console.log('Upload to Firebase Storage successful for logo');
        
        const downloadURL = await getDownloadURL(storageRef);
        console.log('Download URL obtained for logo:', downloadURL);
        
        setSetting(prev => ({
          ...prev,
          schoolLogo: downloadURL
        }));
        triggerToast('Berhasil mengunggah Logo Sekolah!', 'success');
      } catch (storageErr: any) {
        console.warn('Firebase Storage upload failed or timed out for logo, using compressed Base64 database storage:', storageErr);
        
        // 3. Fallback: Store the optimized, ultra-lightweight Base64 Data URL directly inside Firestore Settings
        if (compressedDataUrl) {
          setSetting(prev => ({
            ...prev,
            schoolLogo: compressedDataUrl
          }));
          triggerToast('Berhasil menyimpan Logo Sekolah!', 'success');
        } else {
          throw new Error('Gagal memproses gambar untuk diunggah.');
        }
      }
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      let errorMsg = 'Gagal mengupload Logo';
      if (error.code === 'storage/unauthorized') {
        errorMsg += ': Akses ditolak. Periksa rules Storage.';
      } else if (error.message) {
        errorMsg += `: ${error.message}`;
      }
      triggerToast(errorMsg, 'error');
    } finally {
      setUploadingLogo(false);
      if (e.target) e.target.value = ''; // Reset input
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setting.schoolName) {
      triggerToast('Nama sekolah wajib diisi.', 'error');
      return;
    }
    setSaving(true);
    try {
      const dataToSave = { ...setting, updatedAt: Date.now() };
      await setDoc(doc(db, 'settings', DEFAULT_DOC_ID), dataToSave);
      triggerToast('Pengaturan berhasil disimpan.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings');
      triggerToast('Gagal menyimpan pengaturan.', 'error');
    }
    setSaving(false);
  };

  const removeLogo = () => {
    setSetting(prev => ({ ...prev, schoolLogo: '' }));
    triggerToast('Logo berhasil dihapus dari preview (Tekan Simpan Pengaturan untuk menyimpan perubahan).', 'info');
  };

  if (loading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  return (
    <div className="max-w-4xl relative">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Pengaturan Sekolah</h1>
        <p className="text-slate-500 mt-1">Konfigurasi tampilan dan aturan dasar sistem CBT.</p>
      </div>

      {/* Floating Modern Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-slide-in pointer-events-auto">
          <div className={`p-4 rounded-xl shadow-xl border flex items-center space-x-3 max-w-sm backdrop-blur-md ${
            toast.type === 'success' 
              ? 'bg-emerald-500/95 border-emerald-400 text-white' 
              : toast.type === 'error'
              ? 'bg-rose-500/95 border-rose-400 text-white'
              : 'bg-indigo-600/95 border-indigo-500 text-white'
          }`}>
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 shrink-0" />}
            <span className="text-xs font-semibold leading-relaxed flex-1">{toast.text}</span>
            <button 
              type="button" 
              onClick={() => setToast(null)} 
              className="text-white/80 hover:text-white transition duration-150 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
        <div className="p-6 md:p-8 space-y-8">
          {/* Identitas Sekolah */}
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Identitas Sekolah</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4 flex flex-col justify-center">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nama Sekolah *</label>
                  <input
                    type="text"
                    name="schoolName"
                    value={setting.schoolName}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium placeholder-slate-400"
                    placeholder="Contoh: SMA Negeri 1 Jakarta"
                    required
                  />
                </div>
                
                <div className="pt-2">
                  <span className="block text-xs text-slate-500 leading-relaxed">
                    * Sekolah yang didaftarkan di sini akan muncul pada kop kartu pendaftaran, lembar soal ujian, dan tampilan halaman login CBT.
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Logo Resmi Sekolah</label>
                <div className="flex flex-col space-y-4">
                  {/* Big clear logo preview box */}
                  <div className="border border-dashed border-slate-300 bg-slate-50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[220px] transition-all relative overflow-hidden group">
                    {setting.schoolLogo ? (
                      <div className="flex flex-col items-center space-y-3 w-full">
                        <div className="relative p-2 bg-white rounded-lg shadow-sm border border-slate-100 flex items-center justify-center w-40 h-40">
                          <img 
                            src={setting.schoolLogo} 
                            alt="Logo Sekolah" 
                            className="max-w-full max-h-full object-contain rounded"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={removeLogo}
                          className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded text-xs font-semibold flex items-center space-x-1 cursor-pointer transition shadow-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus Logo</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center text-center space-y-2.5 p-4">
                        <div className="p-3 bg-slate-100 rounded-full text-slate-400 group-hover:scale-105 transition-transform duration-150">
                          <Upload className="w-6 h-6" />
                        </div>
                        <div className="text-xs font-medium text-slate-600">Belum ada logo</div>
                        <p className="text-[10px] text-slate-400 max-w-[200px]">Format JPEG/PNG. Direkomendasikan bentuk persegi atau rasio seimbang.</p>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50 text-xs font-bold uppercase tracking-wider cursor-pointer shadow-xs"
                    >
                      {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>Unggah Gambar Baru</span>
                    </button>
                    <input
                      type="file"
                      ref={logoInputRef}
                      onChange={handleFileUpload}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pengaturan Login & Motivasi */}
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4 pb-2 border-b border-slate-100">Personalisasi & Aturan</h3>
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Pesan Integritas & Motivasi (Halaman Login)</label>
                <textarea
                  name="motivationText"
                  value={setting.motivationText || ''}
                  onChange={handleChange}
                  rows={2}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm placeholder-slate-400"
                  placeholder="Kejujuran adalah prestasi yang paling berharga..."
                />
              </div>

              <div className="max-w-md">
                 <label className="block text-sm font-medium text-slate-700 mb-1">Batas Maksimal Pelanggaran Auto-Diskualifikasi</label>
                 <div className="flex items-center space-x-3">
                   <input
                      type="number"
                      name="maxViolations"
                      value={setting.maxViolations || 3}
                      onChange={handleChange}
                      min={0}
                      className="w-24 px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-center"
                    />
                    <span className="text-sm text-slate-600">pelanggaran (0 = jangan otomatis diskualifikasi)</span>
                  </div>
              </div>
            </div>
          </div>

        </div>
        
        <div className="bg-slate-50 p-6 border-t border-slate-200 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg flex items-center space-x-2 transition-colors font-semibold shadow-sm disabled:opacity-50 text-sm"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            <span>Simpan Pengaturan</span>
          </button>
        </div>
      </form>
    </div>
  );
}
