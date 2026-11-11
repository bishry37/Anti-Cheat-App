import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, orderBy, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { AudioItem } from '../../types';
import { 
  Headphones, Upload, Play, Pause, Trash2, Plus, Search, Music, Clock, 
  AlertCircle, X, CheckCircle2, Edit2, Link as LinkIcon, Globe, ExternalLink, 
  HelpCircle, Volume2
} from 'lucide-react';
import { parseGoogleDriveUrl, getAudioSourceUrls, formatAudioSrc } from '../../lib/audioUtils';
export { parseGoogleDriveUrl };

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
  const [driveUrl, setDriveUrl] = useState('');
  const [allowRepeat, setAllowRepeat] = useState<'Ya' | 'Tidak'>('Ya');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modal Audio Preview testing states
  const [previewAudioStatus, setPreviewAudioStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [previewAudioMsg, setPreviewAudioMsg] = useState('');
  const [previewDuration, setPreviewDuration] = useState<number>(0);
  const [previewStreamUrl, setPreviewStreamUrl] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  // Audio player list states
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
      items.sort((a, b) => b.createdAt - a.createdAt);
      setAudioList(items);
      setLoading(false);
    }, (err) => {
      console.error("Error loading audio bank:", err);
      setLoading(false);
    });

    const timer = setTimeout(() => setLoading(false), 5000);
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [user]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setDriveUrl('');
    setAllowRepeat('Ya');
    setError('');
    setPreviewAudioStatus('idle');
    setPreviewAudioMsg('');
    setPreviewDuration(0);
    setPreviewStreamUrl('');
  };

  const testAudioUrl = (urlToTest: string) => {
    if (!urlToTest || !urlToTest.trim()) {
      setPreviewAudioStatus('error');
      setPreviewAudioMsg('Silakan masukkan URL Google Drive terlebih dahulu.');
      return;
    }

    setPreviewAudioStatus('loading');
    setPreviewAudioMsg('Mengecek ketersediaan audio dari Google Drive...');

    const sources = getAudioSourceUrls(urlToTest);
    if (sources.length === 0) {
      setPreviewAudioStatus('error');
      setPreviewAudioMsg('URL tidak valid.');
      return;
    }

    const { isDrive, fileId } = parseGoogleDriveUrl(urlToTest);

    // Default stream URL
    setPreviewStreamUrl(sources[0]);

    const audioObj = new Audio();
    audioObj.preload = 'auto';

    let hasResponded = false;

    const handleSuccess = (dur: number) => {
      if (hasResponded) return;
      hasResponded = true;
      const validDur = (dur && !isNaN(dur) && dur !== Infinity) ? dur : 0;
      if (validDur > 0) {
        setPreviewDuration(validDur);
        setPreviewAudioStatus('success');
        setPreviewAudioMsg(`Audio terhubung & siap diputar! (Durasi: ${formatDuration(validDur)})`);
      } else {
        setPreviewAudioStatus('success');
        setPreviewAudioMsg('Audio Google Drive terhubung & siap diputar!');
      }
    };

    const trySource = (idx: number) => {
      if (idx >= sources.length) {
        if (!hasResponded) {
          hasResponded = true;
          if (isDrive && fileId) {
            setPreviewAudioStatus('success');
            setPreviewAudioMsg('Link Google Drive valid! Silakan tes putar pada kontrol di bawah. Pastikan izin file diatur ke "Siapa saja yang memiliki link".');
          } else {
            setPreviewAudioStatus('error');
            setPreviewAudioMsg('Gagal memuat audio. Pastikan URL dapat diakses publik.');
          }
        }
        return;
      }

      setPreviewStreamUrl(sources[idx]);
      audioObj.src = sources[idx];

      audioObj.onloadedmetadata = () => handleSuccess(audioObj.duration);
      audioObj.oncanplay = () => handleSuccess(audioObj.duration);
      audioObj.onloadeddata = () => handleSuccess(audioObj.duration);

      audioObj.onerror = () => {
        trySource(idx + 1);
      };

      audioObj.load();
    };

    trySource(0);
  };

  const handleSaveAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama audio wajib diisi.');
      return;
    }

    if (!driveUrl.trim()) {
      setError('Link URL Google Drive wajib diisi.');
      return;
    }

    setUploading(true);
    setError('');

    const { streamUrl, fileId } = parseGoogleDriveUrl(driveUrl);

    try {
      await addDoc(collection(db, 'audio_banks'), {
        adminId: user!.uid,
        name: name.trim(),
        description: description.trim(),
        fileName: fileId ? `Drive (${fileId.substring(0, 8)}...)` : 'Google Drive Audio',
        audioData: streamUrl,
        driveUrl: driveUrl.trim(),
        duration: previewDuration || 0,
        allowRepeat,
        createdAt: Date.now(),
        isChunked: false
      });

      setUploading(false);
      setIsModalOpen(false);
      resetForm();
      setSuccessMsg('Audio Google Drive berhasil ditambahkan!');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error("Gagal menyimpan audio Google Drive:", err);
      setError('Gagal menyimpan ke database. ' + (err.message || ''));
      setUploading(false);
    }
  };

  const handleStartEdit = (item: AudioItem) => {
    setEditingAudio(item);
    setName(item.name);
    setDescription(item.description || '');
    setAllowRepeat(item.allowRepeat);
    setDriveUrl(item.driveUrl || (item.audioData?.startsWith('http') ? item.audioData : ''));
    setPreviewAudioStatus('idle');
    setPreviewAudioMsg('');
    setPreviewDuration(item.duration || 0);
    setIsEditModalOpen(true);
  };

  const handleUpdateAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Nama audio wajib diisi.');
      return;
    }

    if (!driveUrl.trim()) {
      setError('Link URL Google Drive wajib diisi.');
      return;
    }

    if (!editingAudio?.id) return;

    setUploading(true);
    setError('');

    try {
      const { streamUrl } = parseGoogleDriveUrl(driveUrl);
      const finalAudioData = streamUrl;
      const finalDriveUrl = driveUrl.trim();
      let finalDuration = editingAudio.duration;
      if (previewDuration > 0) {
        finalDuration = previewDuration;
      }

      await updateDoc(doc(db, 'audio_banks', editingAudio.id), {
        name: name.trim(),
        description: description.trim(),
        allowRepeat,
        driveUrl: finalDriveUrl,
        audioData: finalAudioData,
        duration: finalDuration
      });

      setUploading(false);
      setIsEditModalOpen(false);
      setEditingAudio(null);
      resetForm();
      setSuccessMsg('Audio berhasil diperbarui.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error("Gagal memperbarui audio:", err);
      setError('Gagal memperbarui ke database. ' + (err.message || ''));
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, audioName: string) => {
    if (window.confirm(`Apakah Anda yakin ingin menghapus audio "${audioName}"?`)) {
      try {
        await deleteDoc(doc(db, 'audio_banks', id));
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

    let rawAudioSrc = '';
    if (item.isChunked) {
      if (audioCache[item.id]) {
        rawAudioSrc = audioCache[item.id];
      } else {
        setLoadingAudioId(item.id);
        try {
          const chunksSnap = await getDocs(collection(db, 'audio_banks', item.id, 'chunks'));
          const sortedChunks = chunksSnap.docs
            .map(d => d.data() as { chunkIndex: number; data: string })
            .sort((a, b) => a.chunkIndex - b.chunkIndex);
          
          const fullAudioData = sortedChunks.map(c => c.data).join('');
          setAudioCache(prev => ({ ...prev, [item.id!]: fullAudioData }));
          rawAudioSrc = fullAudioData;
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
      rawAudioSrc = item.audioData || item.driveUrl || '';
    }

    if (!rawAudioSrc) {
      alert("Data audio tidak ditemukan.");
      return;
    }

    const sources = getAudioSourceUrls(rawAudioSrc);

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio();
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

    const attemptPlaySource = (idx: number) => {
      if (idx >= sources.length) {
        setPlayingId(null);
        alert("Gagal memutar audio. Jika dari Google Drive, pastikan file memiliki izin akses 'Siapa saja yang memiliki link'.");
        return;
      }

      let advanceCalled = false;
      const nextSource = () => {
        if (!advanceCalled) {
          advanceCalled = true;
          attemptPlaySource(idx + 1);
        }
      };

      audio.src = sources[idx];
      audio.onerror = () => nextSource();
      audio.play().catch(err => {
        console.warn(`Audio play attempt ${idx} failed (${sources[idx]}):`, err);
        nextSource();
      });
    };

    attemptPlaySource(0);
  };

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const filteredAudio = audioList.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.fileName && item.fileName.toLowerCase().includes(searchTerm.toLowerCase())) ||
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
            Kelola berkas audio listening ujian Anda menggunakan Google Drive URL atau unggahan langsung.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
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
            placeholder="Cari nama audio atau deskripsi..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
          />
        </div>
        <div className="text-xs font-semibold text-slate-500">
          Total: <span className="text-blue-600 font-bold">{audioList.length}</span> Audio File
        </div>
      </div>

      {/* Audio List Grid */}
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
            {searchTerm ? 'Tidak ditemukan audio yang sesuai dengan pencarian.' : 'Silakan tambahkan berkas audio listening pertama Anda via Google Drive URL.'}
          </p>
          {!searchTerm && (
            <button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
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
            const isDriveAudio = Boolean(item.driveUrl || (item.audioData && item.audioData.startsWith('http')));

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
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80">
                            <Globe className="w-3 h-3 text-emerald-600" /> Google Drive
                          </span>
                        </div>
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

                  {item.driveUrl && (
                    <div className="mb-4">
                      <a 
                        href={item.driveUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Buka Link Google Drive</span>
                      </a>
                    </div>
                  )}
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-100 p-6 flex flex-col animate-in scale-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Headphones className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800">Tambah Audio Google Drive</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Masukkan link Google Drive file audio Anda.</p>
                </div>
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

              <div className="space-y-3 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider">
                    URL Link Google Drive <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGuide(!showGuide)}
                    className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{showGuide ? 'Sembunyikan Petunjuk' : 'Cara Mengambil Link'}</span>
                  </button>
                </div>

                {showGuide && (
                  <div className="p-3 bg-white rounded-lg border border-blue-200 text-[11px] text-slate-700 space-y-1 animate-in fade-in">
                    <p className="font-bold text-blue-800">Petunjuk Salin Link Google Drive:</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-slate-600">
                      <li>Upload file audio (MP3/WAV) ke Google Drive Anda.</li>
                      <li>Klik kanan pada file -&gt; Pilih <strong>Bagikan (Share)</strong>.</li>
                      <li>Ubah Akses Umum menjadi <strong>"Siapa saja yang memiliki link"</strong> (Anyone with the link).</li>
                      <li>Klik <strong>Salin Link</strong> (Copy link) dan tempel di bawah.</li>
                    </ol>
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="url"
                      required
                      placeholder="https://drive.google.com/file/d/..."
                      value={driveUrl}
                      onChange={(e) => {
                        setDriveUrl(e.target.value);
                        setPreviewAudioStatus('idle');
                      }}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => testAudioUrl(driveUrl)}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-xs"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Cek Audio</span>
                  </button>
                </div>

                {/* Audio Preview Box */}
                {previewAudioStatus !== 'idle' && (
                  <div className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                    previewAudioStatus === 'loading' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                    previewAudioStatus === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                    'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      {previewAudioStatus === 'loading' && <div className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />}
                      {previewAudioStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      {previewAudioStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
                      <span className="font-bold">{previewAudioMsg}</span>
                    </div>

                    {previewAudioStatus === 'success' && (
                      <div className="mt-2 pt-2 border-t border-emerald-200/60">
                        <p className="text-[10px] uppercase font-bold text-emerald-700 mb-1">Tes Pemutaran Langsung:</p>
                        <audio 
                          key={`add-${previewStreamUrl || driveUrl}`}
                          src={getAudioSourceUrls(driveUrl || previewStreamUrl)[0]}
                          controls 
                          className="w-full h-8 outline-none"
                        >
                          {getAudioSourceUrls(driveUrl || previewStreamUrl).map((src, idx) => (
                            <source key={idx} src={src} />
                          ))}
                        </audio>
                      </div>
                    )}
                  </div>
                )}
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
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                    <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
                    <span>Menyimpan audio Google Drive...</span>
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
                      <span>Menyimpan...</span>
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
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-100 p-6 flex flex-col animate-in scale-in duration-200 max-h-[90vh] overflow-y-auto">
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

              <div className="space-y-3 bg-blue-50/50 p-4 rounded-xl border border-blue-100">
                <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider">
                  URL Link Google Drive <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="url"
                      required
                      placeholder="https://drive.google.com/file/d/..."
                      value={driveUrl}
                      onChange={(e) => {
                        setDriveUrl(e.target.value);
                        setPreviewAudioStatus('idle');
                      }}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => testAudioUrl(driveUrl)}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-xs"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Cek Audio</span>
                  </button>
                </div>

                {previewAudioStatus !== 'idle' && (
                  <div className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                    previewAudioStatus === 'loading' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                    previewAudioStatus === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                    'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      {previewAudioStatus === 'loading' && <div className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />}
                      {previewAudioStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                      {previewAudioStatus === 'error' && <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
                      <span className="font-bold">{previewAudioMsg}</span>
                    </div>

                    {previewAudioStatus === 'success' && (
                      <div className="mt-2 pt-2 border-t border-emerald-200/60">
                        <p className="text-[10px] uppercase font-bold text-emerald-700 mb-1">Tes Pemutaran Langsung:</p>
                        <audio 
                          key={`edit-${previewStreamUrl || driveUrl}`}
                          src={getAudioSourceUrls(driveUrl || previewStreamUrl)[0]}
                          controls 
                          className="w-full h-8 outline-none"
                        >
                          {getAudioSourceUrls(driveUrl || previewStreamUrl).map((src, idx) => (
                            <source key={idx} src={src} />
                          ))}
                        </audio>
                      </div>
                    )}
                  </div>
                )}
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
