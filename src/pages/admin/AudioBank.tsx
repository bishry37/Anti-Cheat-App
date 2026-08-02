import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, orderBy, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { useAuth } from '../../contexts/AuthContext';
import { AudioItem } from '../../types';
import { Headphones, Upload, Play, Pause, Trash2, Plus, Search, Music, Clock, AlertCircle, X, CheckCircle2, Edit2 } from 'lucide-react';

export default function AudioBank() {
  const { user } = useAuth();
  const [audioList, setAudioList] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingAudio, setEditingAudio] = useState<AudioItem | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [allowRepeat, setAllowRepeat] = useState<'Ya' | 'Tidak'>('Ya');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Audio player preview states
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [audioCache, setAudioCache] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'audio_banks'), where('adminId', '==', user.uid));
    const unsub = onSnapshot(q, (snapshot) => {
      const items: AudioItem[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...(docSnap.data() as any) });
      });
      // Sort by createdAt descending
      items.sort((a, b) => b.createdAt - a.createdAt);
      setAudioList(items);
      setLoading(false);
    }, (err) => {
      console.error("Error loading audio bank:", err);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
    }
  };

  const handleSaveAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama audio wajib diisi.');
      return;
    }
    if (!file) {
      setError('File audio wajib diunggah.');
      return;
    }

    setUploading(true);
    setError('');
    setUploadProgress(5);
    setUploadStage('Mempersiapkan unggahan (Tanpa Batasan Ukuran)...');

    try {
      let duration = 0;
      try {
        const objectUrl = URL.createObjectURL(file);
        duration = await new Promise<number>((resolve) => {
          const audioObj = new Audio(objectUrl);
          audioObj.onloadedmetadata = () => {
            const dur = audioObj.duration || 0;
            URL.revokeObjectURL(objectUrl);
            resolve(dur);
          };
          audioObj.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(0);
          };
          setTimeout(() => resolve(0), 4000);
        });
      } catch (e) {
        console.warn("Duration extraction warning:", e);
      }

      setUploadStage('Mengunggah file ke Cloud Storage...');
      const storagePath = `audio_banks/${user!.uid}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 90;
          setUploadProgress(Math.round(5 + progress));
          setUploadStage(`Mengunggah: ${Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)}% (${(snapshot.bytesTransferred / (1024 * 1024)).toFixed(1)} MB)`);
        },
        (err) => {
          console.error("Storage upload error:", err);
          setError('Gagal mengunggah file ke Cloud Storage: ' + err.message);
          setUploading(false);
        },
        async () => {
          setUploadStage('Menyimpan metadata...');
          setUploadProgress(95);
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

          await addDoc(collection(db, 'audio_banks'), {
            adminId: user!.uid,
            name: name.trim(),
            description: description.trim(),
            fileName: file.name,
            audioUrl: downloadURL,
            audioData: '',
            duration,
            allowRepeat,
            createdAt: Date.now(),
            isChunked: false
          });

          setUploadProgress(100);
          setUploading(false);
          setIsModalOpen(false);
          setName('');
          setDescription('');
          setFile(null);
          setAllowRepeat('Ya');
          setUploadProgress(0);
          setUploadStage('');
          setSuccessMsg('Audio berhasil diunggah tanpa batasan ukuran!');
          setTimeout(() => setSuccessMsg(''), 4000);
        }
      );
    } catch (err: any) {
      console.error("Error saving audio:", err);
      setError('Terjadi kesalahan saat mengunggah audio: ' + (err.message || ''));
      setUploading(false);
    }
  };

  const handleStartEdit = (item: AudioItem) => {
    setEditingAudio(item);
    setName(item.name);
    setDescription(item.description || '');
    setAllowRepeat(item.allowRepeat);
    setIsEditModalOpen(true);
  };

  const handleUpdateAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama audio wajib diisi.');
      return;
    }
    
    if (!editingAudio?.id) return;
    
    setUploading(true);
    setError('');
    
    try {
      await updateDoc(doc(db, 'audio_banks', editingAudio.id), {
        name: name.trim(),
        description: description.trim(),
        allowRepeat
      });
      
      setUploading(false);
      setIsEditModalOpen(false);
      setEditingAudio(null);
      setName('');
      setDescription('');
      setAllowRepeat('Ya');
      setSuccessMsg('Audio berhasil diperbarui.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error("Gagal memperbarui audio:", err);
      setError('Gagal memperbarui ke database. ' + (err.message || ''));
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, audioName: string) => {
    const itemToDelete = audioList.find(i => i.id === id);
    if (window.confirm(`Apakah Anda yakin ingin menghapus audio "${audioName}"?`)) {
      try {
        await deleteDoc(doc(db, 'audio_banks', id));
        if (itemToDelete?.audioUrl) {
          try {
            const storageRef = ref(storage, itemToDelete.audioUrl);
            await deleteObject(storageRef);
          } catch (e) {
            console.warn("Could not delete file from storage:", e);
          }
        }
        if (playingId === id) {
          if (audioRef.current) audioRef.current.pause();
          setPlayingId(null);
        }
        setSuccessMsg('Audio berhasil dihapus.');
        setTimeout(() => setSuccessMsg(''), 4000);
      } catch (err) {
        console.error("Gagal menghapus audio:", err);
        alert('Gagal menghapus audio.');
      }
    }
  };

  const togglePlay = async (item: AudioItem) => {
    if (!item.id) return;

    if (playingId === item.id) {
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingId(null);
      }
      return;
    }

    let audioSrc = '';
    if (item.audioUrl) {
      audioSrc = item.audioUrl;
    } else if (item.isChunked) {
      if (audioCache[item.id]) {
        audioSrc = audioCache[item.id];
      } else {
        setLoadingAudioId(item.id);
        try {
          const chunksSnap = await getDocs(collection(db, 'audio_banks', item.id, 'chunks'));
          const sortedChunks = chunksSnap.docs
            .map(d => d.data() as { chunkIndex: number; data: string })
            .sort((a, b) => a.chunkIndex - b.chunkIndex);
          
          const fullAudioData = sortedChunks.map(c => c.data).join('');
          setAudioCache(prev => ({ ...prev, [item.id!]: fullAudioData }));
          audioSrc = fullAudioData;
        } catch (err) {
          console.error("Gagal memuat chunks audio:", err);
          alert("Gagal memuat file audio.");
          setLoadingAudioId(null);
          return;
        } finally {
          setLoadingAudioId(null);
        }
      }
    } else {
      audioSrc = item.audioData || '';
    }

    if (!audioSrc) {
      alert("Data audio tidak ditemukan.");
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(audioSrc);
    audioRef.current = audio;
    setPlayingId(item.id);
    setDuration(item.duration || 0);
    setCurrentTime(0);

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      setPlayingId(null);
      setCurrentTime(0);
    };

    audio.play().catch(err => {
      console.error("Gagal memutar audio:", err);
      setPlayingId(null);
    });
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const filteredAudio = audioList.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl shadow-xs border border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Headphones className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800 tracking-tight">Manajemen Audio Listening</h1>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            Kelola seluruh berkas audio listening ujian Anda di satu tempat terpusat.
          </p>
        </div>
        <button
          onClick={() => {
            setError('');
            setName('');
            setDescription('');
            setFile(null);
            setAllowRepeat('Ya');
            setUploadProgress(0);
            setUploadStage('');
            setIsModalOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Audio</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in duration-200 text-xs font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Search Bar & Stats */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari nama audio atau file..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
          />
        </div>
        <div className="text-xs font-semibold text-slate-500">
          Total: <span className="text-blue-600 font-bold">{audioList.length}</span> Audio File
        </div>
      </div>

      {/* Audio List Grid / Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : filteredAudio.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Music className="w-8 h-8" />
          </div>
          <h3 className="text-sm font-bold text-slate-700 mb-1">Belum Ada Audio</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto mb-6">
            {searchTerm ? 'Tidak ditemukan audio yang sesuai dengan pencarian.' : 'Silakan tambahkan berkas audio listening pertama Anda.'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Audio Sekarang</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAudio.map((item) => {
            const isPlaying = playingId === item.id;
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all p-5 flex flex-col justify-between group">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${isPlaying ? 'bg-blue-600 text-white animate-pulse' : 'bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white'}`}>
                        <Headphones className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-800 line-clamp-1">{item.name}</h3>
                        <p className="text-[11px] font-medium text-slate-400 truncate max-w-[180px]">{item.fileName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartEdit(item)}
                        className="text-slate-400 hover:text-blue-600 p-2 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                        title="Edit Audio"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id!, item.name)}
                        className="text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                        title="Hapus Audio"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {item.description && (
                    <p className="text-xs text-slate-600 mb-4 line-clamp-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                      {item.description}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-500 mb-4 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Durasi: <strong>{formatDuration(item.duration || 0)}</strong></span>
                    </div>
                    <div>
                      <span>Ulang Audio: <strong className={item.allowRepeat === 'Ya' ? 'text-emerald-600' : 'text-amber-600'}>{item.allowRepeat}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Audio Player Controls */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                  <button
                    onClick={() => togglePlay(item)}
                    disabled={loadingAudioId !== null && loadingAudioId !== item.id}
                    className={`flex items-center justify-center gap-2 flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      isPlaying 
                        ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm' 
                        : 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm'
                    } ${(loadingAudioId === item.id) ? 'opacity-70 cursor-wait' : ''}`}
                  >
                    {loadingAudioId === item.id ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>
                      {loadingAudioId === item.id 
                        ? 'Memuat...' 
                        : isPlaying 
                          ? 'Jeda Audio' 
                          : 'Putar Audio'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Audio Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 p-6 flex flex-col animate-in scale-in duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Upload className="w-5 h-5" />
                </div>
                <h3 className="text-base font-extrabold text-slate-800">Tambah Audio Baru</h3>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveAudio} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Audio <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Listening Section Part 1 - Bahasa Inggris"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Deskripsi Audio (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Keterangan singkat tentang audio..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  File Audio <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-all">
                    <div className="flex flex-col items-center justify-center pt-3 pb-4 px-4 text-center">
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                      <p className="text-xs text-slate-600 font-medium truncate max-w-[260px]">
                        {file ? file.name : <span className="font-bold text-blue-600">Klik untuk upload audio</span>}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">MP3, WAV, M4A, OGG (Tanpa batas ukuran)</p>
                    </div>
                    <input 
                      type="file" 
                      accept=".mp3,.wav,.m4a,.ogg,audio/*" 
                      onChange={handleFileChange} 
                      className="hidden" 
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Izinkan Peserta Mengulang Audio?
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAllowRepeat('Ya')}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      allowRepeat === 'Ya'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Ya (Bebas Diulang)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowRepeat('Tidak')}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      allowRepeat === 'Tidak'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Tidak (Hanya 1 Kali)
                  </button>
                </div>
              </div>

              {uploading && (
                <div className="bg-blue-50 border border-blue-200/80 p-3.5 rounded-xl space-y-2 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                    <span className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>{uploadStage || 'Mengunggah audio...'}</span>
                    </span>
                    <span className="text-blue-700 font-extrabold">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200/80 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out shadow-2xs"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Mengunggah ({uploadProgress}%)</span>
                    </>
                  ) : (
                    <span>Simpan Audio</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Audio Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-100 p-6 flex flex-col animate-in scale-in duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Edit2 className="w-5 h-5" />
                </div>
                <h3 className="text-base font-extrabold text-slate-800">Edit Audio</h3>
              </div>
              <button 
                onClick={() => setIsEditModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleUpdateAudio} className="space-y-4 font-sans">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Audio <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Listening Section Part 1 - Bahasa Inggris"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Deskripsi Audio (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Keterangan singkat tentang audio..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Izinkan Peserta Mengulang Audio?
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAllowRepeat('Ya')}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      allowRepeat === 'Ya'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Ya (Bebas Diulang)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowRepeat('Tidak')}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      allowRepeat === 'Tidak'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Tidak (Hanya 1 Kali)
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>Perbarui Audio</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
