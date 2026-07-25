import React, { useState, useRef } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { db, storage } from '../lib/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { auth } from '../lib/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  subjectId: string;
  packetName: string;
}

export function AudioUploadModal({ isOpen, onClose, subjectId, packetName }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [allowRepetition, setAllowRepetition] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !auth.currentUser) return;

    setUploading(true);
    setProgress(0);
    try {
      // 1. Upload to Storage
      const storageRef = ref(storage, `audio/${auth.currentUser.uid}/${subjectId}/${packetName}/${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progressPercent = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setProgress(progressPercent);
        },
        (error) => {
          console.error(error);
          alert('Gagal mengunggah audio: ' + error.message);
          setUploading(false);
        },
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

          // 2. Save metadata to Firestore
          await addDoc(collection(db, 'audio_packets'), {
            adminId: auth.currentUser.uid,
            subjectId,
            packetName,
            audioUrl: downloadUrl,
            allowRepetition,
            fileName: file.name,
            createdAt: Date.now()
          });

          onClose();
          alert('Audio berhasil diunggah!');
          setUploading(false);
        }
      );
    } catch (error) {
      console.error(error);
      alert('Gagal memulai upload.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-bold text-slate-800">Upload Audio Listening</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
        </div>

        <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
        
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-500 hover:text-blue-600 transition-colors flex flex-col items-center justify-center gap-2 mb-4"
        >
          <Upload className="w-6 h-6" />
          <span className="text-sm font-semibold">{file ? file.name : "Pilih File Audio (MP3, WAV, M4A, OGG)"}</span>
        </button>

        {uploading && (
          <div className="mb-4">
            <div className="w-full bg-slate-200 rounded-full h-2.5">
              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="text-xs text-slate-500 mt-1">{Math.round(progress)}% terunggah</p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-6">
          <input 
            type="checkbox" 
            checked={allowRepetition} 
            onChange={(e) => setAllowRepetition(e.target.checked)}
            className="w-4 h-4"
          />
          <label className="text-sm text-slate-700">Izinkan peserta mengulang audio</label>
        </div>

        <button 
          onClick={handleUpload}
          disabled={uploading || !file}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Simpan Audio"}
        </button>
      </div>
    </div>
  );
}
