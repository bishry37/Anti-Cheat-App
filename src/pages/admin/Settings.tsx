import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType, storage } from '../../lib/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Setting } from '../../types';
import { Save, Loader2, AlertCircle, Shield, Upload, X, CheckCircle2, Info, Trash2, UserCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

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
  const { user } = useAuth();
  const [setting, setSetting] = useState<Setting>({
    schoolName: '',
    schoolLogo: '',
    schoolAddress: '',
    schoolSlogan: '',
    motivationText: '',
    teacherPhoto: '',
    teacherName: '',
    teacherRole: '',
    maxViolations: 3,
    updatedAt: Date.now()
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingTeacherPhoto, setUploadingTeacherPhoto] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const teacherPhotoInputRef = useRef<HTMLInputElement>(null);

  const SETTINGS_DOC_ID = user?.uid || 'school';

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
    if (!user) return;
    
    // Listen to settings changes in real-time
    const unsub = onSnapshot(doc(db, 'settings', SETTINGS_DOC_ID), (docSnap) => {
      if (docSnap.exists()) {
        setSetting(docSnap.data() as Setting);
      }
      setLoading(false);
    }, (err) => {
      console.error('Error fetching settings:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;
    
    // Normalize dynamic user-scoped name back to state property keys
    if (name.startsWith('schoolName_')) name = 'schoolName';
    if (name.startsWith('teacherName_')) name = 'teacherName';
    if (name.startsWith('teacherRole_')) name = 'teacherRole';

    setSetting(prev => ({
      ...prev,
      [name]: name === 'maxViolations' ? parseInt(value) || 0 : value
    }));
  };

  const processAndUploadImage = async (file: File, type: 'logo' | 'teacher'): Promise<string> => {
    // 1. Optimize and compress image
    let compressedDataUrl = '';
    try {
      compressedDataUrl = await compressAndResizeImage(file, 400, 400);
    } catch (compressErr) {
      console.error('Failed to compress image:', compressErr);
    }

    let uploadBlob: Blob | File = file;
    if (compressedDataUrl) {
      try {
        const response = await fetch(compressedDataUrl);
        uploadBlob = await response.blob();
      } catch (fetchErr) {
        console.error('Failed to convert base64 to blob:', fetchErr);
      }
    }

    const storageRef = ref(storage, `settings/${type}_${Date.now()}_${file.name}`);
    
    // 2. Attempt to upload to Storage
    const uploadPromise = uploadBytes(storageRef, uploadBlob);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase Storage timeout')), 4000)
    );

    try {
      await Promise.race([uploadPromise, timeoutPromise]);
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (storageErr) {
      console.warn(`Storage upload failed for ${type}, using compressed Base64:`, storageErr);
      // 3. Fallback to base64
      if (compressedDataUrl) {
        return compressedDataUrl;
      } else {
        throw new Error('Gagal memproses gambar untuk diunggah.');
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'teacher') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      triggerToast('File harus berupa berkas gambar', 'error');
      return;
    }

    try {
      if (type === 'logo') setUploadingLogo(true);
      else setUploadingTeacherPhoto(true);

      triggerToast(`Mengupload ${type === 'logo' ? 'Logo' : 'Foto Guru'}...`, 'info');
      
      const url = await processAndUploadImage(file, type);
      
      if (type === 'logo') {
        setSetting(prev => ({ ...prev, schoolLogo: url }));
        triggerToast('Berhasil mengunggah Logo!', 'success');
      } else {
        setSetting(prev => ({ ...prev, teacherPhoto: url }));
        triggerToast('Berhasil mengunggah Foto Guru!', 'success');
      }
    } catch (error: any) {
      console.error(`Error uploading ${type}:`, error);
      let errorMsg = `Gagal mengupload ${type === 'logo' ? 'Logo' : 'Foto Guru'}`;
      if (error.code === 'storage/unauthorized') {
        errorMsg += ': Akses ditolak. Periksa rules Storage.';
      } else if (error.message) {
        errorMsg += `: ${error.message}`;
      }
      triggerToast(errorMsg, 'error');
    } finally {
      if (type === 'logo') setUploadingLogo(false);
      else setUploadingTeacherPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      // If teacher name is empty, fill with user's email address
      const teacherName = setting.teacherName?.trim() || user.email || '';
      const dataToSave = { 
        ...setting, 
        teacherName,
        updatedAt: Date.now(), 
        adminId: user.uid 
      };
      await setDoc(doc(db, 'settings', SETTINGS_DOC_ID), dataToSave);
      triggerToast('Pengaturan berhasil disimpan.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'settings');
      triggerToast('Gagal menyimpan pengaturan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeLogo = () => {
    setSetting(prev => ({ ...prev, schoolLogo: '' }));
    triggerToast('Logo sekolah berhasil dihapus dari preview.', 'info');
  };

  const removeTeacherPhoto = () => {
    setSetting(prev => ({ ...prev, teacherPhoto: '' }));
    triggerToast('Foto guru berhasil dihapus dari preview.', 'info');
  };

  if (loading) {
    return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;
  }

  return (
    <div className="max-w-6xl relative space-y-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Pengaturan Ruang Kerja & Identitas</h1>
        <p className="text-slate-500 mt-1">Konfigurasi tampilan sekolah dan profil guru untuk sesi ujian ini.</p>
      </div>

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
            <button type="button" onClick={() => setToast(null)} className="text-white/80 hover:text-white transition duration-150 shrink-0 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6" autoComplete="off" data-lpignore="true">
        
        {/* Anti-autofill Honeypot Inputs to absorb browser caching patterns */}
        <input style={{ display: 'none' }} type="text" name="fake_schoolname_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />
        <input style={{ display: 'none' }} type="text" name="fake_teachername_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />
        <input style={{ display: 'none' }} type="text" name="fake_teacherrole_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />

        {/* ROW 1: School Identity & Teacher Profile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Identity School */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
               <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Identitas Sekolah</h3>
            </div>
            <div className="p-6 space-y-6 flex-1">
               <div>
                <label htmlFor={`schoolName_input_${user?.uid || 'default'}`} className="block text-sm font-medium text-slate-700 mb-1.5">Nama Sekolah (Opsional)</label>
                <input
                  id={`schoolName_input_${user?.uid || 'default'}`}
                  autoComplete={`off-field-${(user?.uid || '').substring(0, 8)}`}
                  data-lpignore="true"
                  type="text"
                  name={`schoolName_${(user?.uid || '').substring(0, 10)}`}
                  value={setting.schoolName || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium placeholder-slate-400"
                  placeholder="Contoh: SMA Negeri 1 Jakarta"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Logo Resmi Sekolah</label>
                <div className="border border-dashed border-slate-300 bg-slate-50/50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[160px] transition-all relative overflow-hidden group">
                  {setting.schoolLogo ? (
                    <div className="flex flex-col items-center space-y-3 w-full">
                      <div className="relative p-2 bg-white rounded-lg shadow-sm border border-slate-100 flex items-center justify-center w-24 h-24">
                        <img src={setting.schoolLogo} alt="Logo" className="max-w-full max-h-full object-contain rounded" />
                      </div>
                      <button type="button" onClick={removeLogo} className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded text-xs font-semibold flex items-center space-x-1 cursor-pointer transition shadow-xs">
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Logo</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-center space-y-2 p-2">
                       <Upload className="w-5 h-5 text-slate-400" />
                      <div className="text-xs font-medium text-slate-600">Belum ada logo</div>
                    </div>
                  )}
                </div>
                <div className="flex justify-center mt-3">
                  <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50 text-[10px] font-bold uppercase tracking-widest cursor-pointer shadow-3xs">
                    {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>Unggah Logo</span>
                  </button>
                  <input type="file" ref={logoInputRef} onChange={e => handleFileUpload(e, 'logo')} accept="image/*" className="hidden" />
                </div>
              </div>
            </div>
          </div>

          {/* Teacher Profile */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
               <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">Profil Informasi Guru</h3>
            </div>
            <div className="p-6 space-y-4 flex-1">
              <div>
                <label htmlFor={`teacherName_input_${user?.uid || 'default'}`} className="block text-sm font-medium text-slate-700 mb-1.5">Nama Guru</label>
                <input
                  id={`teacherName_input_${user?.uid || 'default'}`}
                  autoComplete={`off-field-${(user?.uid || '').substring(0, 8)}`}
                  data-lpignore="true"
                  type="text"
                  name={`teacherName_${(user?.uid || '').substring(0, 10)}`}
                  value={setting.teacherName || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm placeholder-slate-400"
                  placeholder="Bapak/Ibu Guru..."
                />
              </div>
              
              <div>
                <label htmlFor={`teacherRole_input_${user?.uid || 'default'}`} className="block text-sm font-medium text-slate-700 mb-1.5">Jabatan / Keterangan</label>
                <input
                  id={`teacherRole_input_${user?.uid || 'default'}`}
                  autoComplete={`off-field-${(user?.uid || '').substring(0, 8)}`}
                  data-lpignore="true"
                  type="text"
                  name={`teacherRole_${(user?.uid || '').substring(0, 10)}`}
                  value={setting.teacherRole || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm placeholder-slate-400"
                  placeholder="Guru Mata Pelajaran Matematika"
                />
              </div>

               <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Foto Profil Guru</label>
                <div className="border border-dashed border-slate-300 bg-slate-50/50 rounded-xl p-4 flex flex-col items-center justify-center min-h-[140px] transition-all relative overflow-hidden group">
                  {setting.teacherPhoto ? (
                    <div className="flex flex-col items-center space-y-3 w-full">
                      <div className="relative w-20 h-20 rounded-full border border-slate-200 shadow-sm overflow-hidden bg-white">
                        <img src={setting.teacherPhoto} alt="Guru" className="w-full h-full object-cover" />
                      </div>
                      <button type="button" onClick={removeTeacherPhoto} className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded text-xs font-semibold flex items-center space-x-1 cursor-pointer transition shadow-xs">
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Foto</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-center space-y-2 p-2">
                       <UserCircle className="w-5 h-5 text-slate-400" />
                      <div className="text-xs font-medium text-slate-600">Belum ada foto</div>
                    </div>
                  )}
                </div>
                <div className="flex justify-center mt-3">
                  <button type="button" onClick={() => teacherPhotoInputRef.current?.click()} disabled={uploadingTeacherPhoto} className="bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50 text-[10px] font-bold uppercase tracking-widest cursor-pointer shadow-3xs">
                    {uploadingTeacherPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>Unggah Foto</span>
                  </button>
                  <input type="file" ref={teacherPhotoInputRef} onChange={e => handleFileUpload(e, 'teacher')} accept="image/*" className="hidden" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 p-6 border border-slate-200 rounded-xl flex justify-end shadow-sm">
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg flex items-center space-x-2 transition-colors font-semibold shadow-sm disabled:opacity-50 text-sm">
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            <span>Simpan Pengaturan</span>
          </button>
        </div>
      </form>

      {/* ROW 3: Account Security removed - moved to sidebar */}
    </div>
  );
}
