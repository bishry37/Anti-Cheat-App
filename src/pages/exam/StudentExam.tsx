import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, handleFirestoreError, OperationType, auth } from '../../lib/firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, onSnapshot } from 'firebase/firestore';
import { StudentSession, Exam, Question, Setting, Violation, AudioItem } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { ShieldAlert, Maximize, Clock, Save, AlertTriangle, LogOut, Loader2, Wifi, WifiOff, Play, Check, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { formatHTML, calculateSmartPoints } from '../../utils/textFormat';
import { getAudioSourceUrls, formatAudioSrc } from '../../lib/audioUtils';
import { renderMathInContainers } from '../../utils/mathRenderer';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const isOptionEmpty = (val: string | undefined | null): boolean => {
  if (!val) return true;
  const str = String(val).trim();
  if (/<(img|audio|video|iframe|svg|math)/i.test(str)) {
    return false;
  }
  const plainText = str.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
  return plainText === '';
};

const CustomAudioPlayer = ({ audioItem, hasPlayedAudio, setHasPlayedAudio }: { audioItem: AudioItem, hasPlayedAudio: boolean, setHasPlayedAudio: (val: boolean) => void }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSrcIdx, setCurrentSrcIdx] = useState(0);

  const rawData = audioItem.audioData || audioItem.driveUrl || (audioItem as any).data;
  const sources = getAudioSourceUrls(rawData);
  const isOneTime = audioItem.allowRepeat === 'Tidak';

  const handleAudioError = () => {
    if (currentSrcIdx < sources.length - 1) {
      const nextIdx = currentSrcIdx + 1;
      setCurrentSrcIdx(nextIdx);
      if (audioRef.current) {
        audioRef.current.src = sources[nextIdx];
        if (isPlaying) {
          audioRef.current.play().catch(() => {});
        }
      }
    }
  };

  if (!isOneTime) {
    return (
      <div className="w-full" onContextMenu={(e) => e.preventDefault()}>
        <audio 
          controls
          controlsList="nodownload noplaybackrate"
          src={sources[currentSrcIdx] || sources[0]}
          onError={handleAudioError}
          className="w-full h-10 accent-blue-600 outline-none"
        >
          {sources.map((src, i) => (
            <source key={i} src={src} />
          ))}
          Browser Anda tidak mendukung elemen pemutar audio.
        </audio>
      </div>
    );
  }

  const handlePlayOneTime = () => {
    if (!hasPlayedAudio && !isPlaying && audioRef.current) {
      audioRef.current.play().catch(e => {
        console.warn(`Play failed for source index ${currentSrcIdx}:`, e);
        if (currentSrcIdx < sources.length - 1) {
          const nextIdx = currentSrcIdx + 1;
          setCurrentSrcIdx(nextIdx);
          if (audioRef.current) {
            audioRef.current.src = sources[nextIdx];
            audioRef.current.play().catch(err => console.error("Fallback play failed:", err));
          }
        }
      });
    }
  };

  return (
    <div onContextMenu={(e) => e.preventDefault()}>
      <audio 
        ref={audioRef}
        src={sources[currentSrcIdx] || sources[0]}
        className="hidden"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={handleAudioError}
        onTimeUpdate={(e) => {
           const el = e.currentTarget;
           if (el.duration) {
             setProgress((el.currentTime / el.duration) * 100);
           }
        }}
        onEnded={() => {
           setIsPlaying(false);
           setHasPlayedAudio(true);
           setProgress(100);
        }}
      />
      <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-blue-100 shadow-sm">
        <button 
          onClick={handlePlayOneTime}
          disabled={hasPlayedAudio || isPlaying}
          className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${hasPlayedAudio ? 'bg-slate-100 text-slate-400' : isPlaying ? 'bg-blue-100 text-blue-500' : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md'} transition-all`}
        >
           {hasPlayedAudio ? <Check className="w-5 h-5" /> : isPlaying ? <Volume2 className="w-5 h-5 animate-pulse" /> : <Play className="w-5 h-5 ml-1" />}
        </button>
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            {hasPlayedAudio ? 'Audio Selesai Diputar' : isPlaying ? 'Memutar Audio...' : 'Putar Audio (Sekali Putar)'}
          </div>
          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
             <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default function StudentExam() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<StudentSession | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [settings, setSettings] = useState<Setting | null>(null);
  const [loadError, setLoadError] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [audioItem, setAudioItem] = useState<AudioItem | null>(null);
  const [hasPlayedAudio, setHasPlayedAudio] = useState(false);
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  
  const [timeLeft, setTimeLeft] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [acknowledgedWarningTime, setAcknowledgedWarningTime] = useState<number>(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmittingOrFinished, setIsSubmittingOrFinished] = useState(false);
  const [showSubmitErrorModal, setShowSubmitErrorModal] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  const containerRef = useRef<HTMLDivElement>(null);

  // References to completely mitigate React stale closures on asynchronous timers/listeners
  const lastProcessedAdjustedAt = useRef<number | null>(null);
  const answersRef = useRef<Record<string, string>>({});
  const sessionRef = useRef<StudentSession | null>(null);
  const examRef = useRef<Exam | null>(null);
  const questionsRef = useRef<Question[]>([]);
  const isSubmittingOrFinishedRef = useRef(false);

  // Synchronize state values directly into references
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    examRef.current = exam;
  }, [exam]);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  useEffect(() => {
    isSubmittingOrFinishedRef.current = isSubmittingOrFinished;
  }, [isSubmittingOrFinished]);

  // Disable Google Translate and other translation extensions dynamically
  useEffect(() => {
    document.body.setAttribute('translate', 'no');
    document.body.classList.add('notranslate');
    
    const meta = document.createElement('meta');
    meta.name = 'google';
    meta.content = 'notranslate';
    document.head.appendChild(meta);

    return () => {
      document.body.removeAttribute('translate');
      document.body.classList.remove('notranslate');
      if (document.head.contains(meta)) {
        document.head.removeChild(meta);
      }
    };
  }, []);

  // Submit Exam Function (Declared Early for full accessibility and auto-timeouts)
  const submitExam = useCallback(async () => {
    const sessionVal = sessionRef.current;
    const examVal = examRef.current;
    const isSubmittingOrFinishedVal = isSubmittingOrFinishedRef.current;
    const questionsVal = questionsRef.current;
    const answersVal = answersRef.current;

    if (!sessionVal || !examVal || isSubmittingOrFinishedVal) return;
    
    // Set submitting flag immediately to prevent duplicate runs and ignore external alerts
    setIsSubmittingOrFinished(true);
    isSubmittingOrFinishedRef.current = true;
    
    const totalQuestions = questionsVal.length;
    if (totalQuestions === 0) {
      alert('Tidak ada soal dalam ujian ini. Silakan hubungi pengawas.');
      setIsSubmittingOrFinished(false);
      isSubmittingOrFinishedRef.current = false;
      return;
    }

    // Calculate weight-based score
    let pointsEarned = 0;
    let totalWeight = 0;
    let correct = 0;
    let wrong = 0;
    
    questionsVal.forEach(q => {
      const weight = q.weight || 10;
      totalWeight += weight;
      
      const studentAns = answersVal[q.id!];
      
      if (q.type === 'pilihan_ganda' || q.type === 'listening') {
        if (studentAns === q.correctAnswer) {
          correct++;
          pointsEarned += weight;
        } else {
          wrong++;
        }
      } else if (q.type === 'pilihan_ganda_kompleks') {
        const correctKeys = (q.correctAnswer || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        const studentKeys = (studentAns || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        
        // Check if student selected any wrong choice (not in correctKeys)
        const hasWrongKey = studentKeys.some(k => !correctKeys.includes(k));
        
        if (studentKeys.length === 0 || hasWrongKey) {
          wrong++;
        } else {
          // Selected only correct choices
          const ratio = studentKeys.length / correctKeys.length;
          const earned = ratio * weight;
          pointsEarned += earned;
          correct++;
        }
      } else {
        // Smart grading for isian_singkat and essay
        const earned = calculateSmartPoints(studentAns || '', q.correctAnswer || '', weight);
        pointsEarned += earned;
        if (earned === weight) {
          correct++;
        } else if (earned > 0) {
          correct++; 
        } else {
          wrong++;
        }
      }
    });

    const score = totalWeight > 0 ? (pointsEarned / totalWeight) * 100 : 0;

    // Set local session state status to Complete instantly for fast UI feedback
    setSession(prev => prev ? { ...prev, status: 'Selesai', score, correctCount: correct, wrongCount: wrong } : null);

    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), {
        status: 'Selesai',
        endTime: Date.now(),
        score,
        correctCount: correct,
        wrongCount: wrong,
        answers: answersVal
      });

      // Clear local backup
      if (examVal.id && user?.uid) {
        localStorage.removeItem(`cbt_answers_${user.uid}_${examVal.id}`);
        localStorage.removeItem(`cbt_remaining_time_${user.uid}_${examVal.id}`);
      }

      // Safety: Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (e) {
      console.error("Gagal submit ujian:", e);
      setIsSubmittingOrFinished(false);
      isSubmittingOrFinishedRef.current = false;
      setShowSubmitErrorModal(true);
    }
  }, [user]);

  // Real-time Clock Timer
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Listen to Settings in real-time based on session adminId
  useEffect(() => {
    if (!session?.adminId) return;
    
    const unsub = onSnapshot(doc(db, 'settings', session.adminId), (docSnap) => {
      if (docSnap.exists()) {
        setSettings(docSnap.data() as Setting);
      }
    });

    return () => unsub();
  }, [session?.adminId]);

  // Load Initial Data
  useEffect(() => {
    if (!user) return;

    // Reset all student states immediately when user changes to prevent cross-account leaks
    setSession(null);
    setExam(null);
    setQuestions([]);
    setAnswers({});
    answersRef.current = {};
    setCurrentQuestionIndex(0);
    setLoadError('');

    async function loadData() {
      try {
        const sessSnap = await getDoc(doc(db, 'student_sessions', user!.uid));
        if (!sessSnap.exists()) {
          setLoadError("Sesi ujian tidak valid atau Anda bukan siswa yang terdaftar. Mohon logout lalu login sebagai Admin.");
          return;
        }
        const sessData = { id: sessSnap.id, ...sessSnap.data() } as StudentSession;
        setSession(sessData);

        // Merge with local storage backup to handle extreme connection / power failure cases (scoped by student UID)
        let localBackup: Record<string, string> = {};
        try {
          const stored = localStorage.getItem(`cbt_answers_${user.uid}_${sessData.examId}`);
          if (stored) {
            localBackup = JSON.parse(stored);
          }
        } catch (e) {
          console.error("Gagal membaca backup jawaban lokal", e);
        }
        const serverAnswers = sessData.answers || {};
        const mergedAnswers = { ...localBackup, ...serverAnswers };

        setAnswers(mergedAnswers);
        answersRef.current = mergedAnswers;

        if (sessData.lastQuestionIndex !== undefined) {
          setCurrentQuestionIndex(sessData.lastQuestionIndex);
        }

        const exSnap = await getDoc(doc(db, 'exams', sessData.examId));
        if (exSnap.exists()) {
          const exData = exSnap.data() as Exam;
          setExam(exData);

          if (exData.audioId) {
            try {
              let audioSnap = await getDoc(doc(db, 'audio_banks', exData.audioId));
              if (!audioSnap.exists()) {
                const allAudioSnap = await getDocs(collection(db, 'audio_banks'));
                const found = allAudioSnap.docs.find(d => d.id === exData.audioId || d.data().name === exData.audioId);
                if (found) {
                  audioSnap = found as any;
                }
              }
              if (audioSnap && (audioSnap as any).exists && (audioSnap as any).exists()) {
                const audioDataRaw = (audioSnap as any).data();
                if (audioDataRaw.isChunked) {
                  const chunksSnap = await getDocs(collection(db, 'audio_banks', audioSnap.id, 'chunks'));
                  const sortedChunks = chunksSnap.docs
                    .map(d => d.data() as { chunkIndex: number; data: string })
                    .sort((a, b) => a.chunkIndex - b.chunkIndex);
                  
                  const fullAudioData = sortedChunks.map(c => c.data).join('');
                  setAudioItem({
                    id: audioSnap.id,
                    ...(audioDataRaw as any),
                    audioData: fullAudioData,
                    data: fullAudioData
                  } as AudioItem);
                } else {
                  setAudioItem({
                    id: audioSnap.id,
                    ...(audioDataRaw as any),
                    audioData: audioDataRaw.audioData || audioDataRaw.driveUrl || audioDataRaw.data,
                    data: audioDataRaw.audioData || audioDataRaw.driveUrl || audioDataRaw.data
                  } as AudioItem);
                }
              }
            } catch (e) {
              console.error("Gagal load audio item with fallback", e);
            }
          }

          const targetSubId = exData.subjectId || sessData.subjectId;
          let loadedSubjectName = 'Mata Pelajaran Tidak Diketahui';
          try {
            if (targetSubId) {
              const subSnap = await getDoc(doc(db, 'subjects', targetSubId));
              if (subSnap.exists()) {
                loadedSubjectName = subSnap.data().name;
              }
            }
          } catch (e) {
            console.error("Gagal load subject name", e);
          }
          setSubjectName(loadedSubjectName);
          
          // Calculate initial time left
          const activeDuration = typeof sessData.duration === 'number' ? sessData.duration : exData.duration;
          let calculatedTimeLeft = 0;
          if (typeof sessData.remainingSeconds === 'number' && sessData.remainingSeconds > 0) {
            calculatedTimeLeft = sessData.remainingSeconds;
          } else {
            const localSaved = localStorage.getItem(`cbt_remaining_time_${user.uid}_${exData.id}`);
            if (localSaved && !isNaN(parseInt(localSaved, 10)) && parseInt(localSaved, 10) > 0) {
              calculatedTimeLeft = parseInt(localSaved, 10);
            } else {
              const elapsed = Math.floor((Date.now() - sessData.startTime) / 1000);
              const totalSecs = Math.round(activeDuration * 60);
              calculatedTimeLeft = Math.max(0, totalSecs - elapsed);
            }
          }

          // Fetch questions with ultra-robust targeted query to save Firestore read quota
          let qs: Question[] = [];
          try {
            // First try targeted query by subjectId to avoid downloading the entire collection
            let allSnap;
            if (targetSubId) {
              allSnap = await getDocs(query(collection(db, 'questions'), where('subjectId', '==', targetSubId)));
            }
            if (!allSnap || allSnap.empty) {
              allSnap = await getDocs(collection(db, 'questions'));
            }
            const allQuestions = allSnap.docs.map(d => {
              const data = d.data() as any;
              let qType = data.type;
              const tCode = data.typeCode;
              if (qType === 1 || qType === '1' || tCode === 1) {
                qType = 'pilihan_ganda';
              } else if (qType === 2 || qType === '2' || tCode === 2) {
                qType = 'listening';
              } else if (qType === 3 || qType === '3' || tCode === 3) {
                qType = 'essay';
              } else if (qType === 4 || qType === '4' || tCode === 4 || qType === 5 || qType === '5' || tCode === 5) {
                qType = 'pilihan_ganda_kompleks';
              } else if (!qType) {
                qType = 'pilihan_ganda';
              }
              return {
                id: d.id,
                ...data,
                type: qType,
                typeCode: tCode || (qType === 'pilihan_ganda_kompleks' ? 4 : qType === 'listening' ? 2 : qType === 'essay' ? 3 : 1)
              } as Question;
            });

            // Filter by target subjectId or examId or loadedSubjectName
            const matchedBySubjectOrExam = allQuestions.filter(q => {
              const qAny = q as any;
              return (targetSubId && q.subjectId === targetSubId) || 
                qAny.examId === sessData.examId || 
                (loadedSubjectName && loadedSubjectName !== 'Mata Pelajaran Tidak Diketahui' && qAny.subjectName === loadedSubjectName);
            });

            let candidateQuestions = matchedBySubjectOrExam.length > 0 ? matchedBySubjectOrExam : allQuestions;

            // Apply packetName filter if specified (prioritize the student's assigned packet in multi-package exams)
            const studentPacket = (sessData.packetName && sessData.packetName.trim() !== '') 
              ? sessData.packetName 
              : exData.packetName;

            if (studentPacket && studentPacket.trim() !== '' && studentPacket !== 'Semua Paket' && studentPacket !== 'Pilih Paket') {
              const cleanExamPacket = studentPacket.trim().toLowerCase();
              const packetFiltered = candidateQuestions.filter(q => {
                if (!q.packetName) return true;
                const qPacket = q.packetName.trim().toLowerCase();
                return qPacket === 'semua paket' || qPacket === cleanExamPacket || qPacket.includes(cleanExamPacket) || cleanExamPacket.includes(qPacket);
              });

              if (packetFiltered.length > 0) {
                qs = packetFiltered;
              } else {
                qs = candidateQuestions; // fallback if packet name didn't match exactly
              }
            } else {
              qs = candidateQuestions;
            }

            // Absolute fallback: if still empty, use all questions
            if (qs.length === 0) {
              qs = allQuestions;
            }
          } catch (fetchErr) {
            console.error("Error fetching questions with ultra-robust fallback:", fetchErr);
            try {
              const allSnap = await getDocs(collection(db, 'questions'));
              qs = allSnap.docs.map(d => {
                const data = d.data() as any;
                return { id: d.id, ...data, type: data.type || 'pilihan_ganda' } as Question;
              });
            } catch (e2) {
              console.error("Ultimate fallback failed:", e2);
            }
          }
          
          const typeOrder: Record<string, number> = { 'pilihan_ganda': 1, 'listening': 2, 'essay': 3, 'pilihan_ganda_kompleks': 4, 'isian_singkat': 5 };
          
          let shouldSaveRandomization = false;
          let generatedQuestionOrder: string[] = [];
          const generatedOptionsOrder: Record<string, string[]> = {};

          if (exData.randomizeQuestions) {
            if (sessData.questionOrder && Array.isArray(sessData.questionOrder) && sessData.questionOrder.length > 0) {
              // Reorder according to the saved questionOrder in student session
              const qOrderMap = new Map<string, number>();
              sessData.questionOrder.forEach((id, idx) => qOrderMap.set(id, idx));
              
              qs.sort((a, b) => {
                const idxA = qOrderMap.has(a.id!) ? qOrderMap.get(a.id!) : 9999;
                const idxB = qOrderMap.has(b.id!) ? qOrderMap.get(b.id!) : 9999;
                return idxA - idxB;
              });
            } else {
              // Listening questions are kept in original order. Other types are shuffled.
              const listeningGroup = qs.filter(q => (q.type || 'pilihan_ganda') === 'listening');
              listeningGroup.sort((a, b) => (a.number || 0) - (b.number || 0));

              const groups: Record<number, Question[]> = { 1: [], 2: [], 4: [], 5: [] };
              qs.forEach(q => {
                const t = q.type || 'pilihan_ganda';
                if (t !== 'listening') {
                  const order = typeOrder[t] || 1;
                  if (!groups[order]) groups[order] = [];
                  groups[order].push(q);
                }
              });
              
              Object.values(groups).forEach(group => {
                group.sort(() => Math.random() - 0.5);
              });
              
              qs = [...groups[1], ...groups[2], ...listeningGroup, ...groups[4], ...groups[5]];
              generatedQuestionOrder = qs.map(q => q.id!);
              shouldSaveRandomization = true;
            }
          } else {
            // Respect the question sequence but grouped by type
            qs = qs.sort((a, b) => {
              const aType = a.type || 'pilihan_ganda';
              const bType = b.type || 'pilihan_ganda';
              if (typeOrder[aType] !== typeOrder[bType]) {
                return typeOrder[aType] - typeOrder[bType];
              }
              return (a.number || 0) - (b.number || 0);
            });
          }

           // Pre-populate shuffled options for all multiple choice questions
          qs = qs.map(q => {
            const validOptions = (['A', 'B', 'C', 'D', 'E'] as const)
              .map(opt => ({
                key: opt,
                text: q[`option${opt}` as keyof Question] as string | undefined
              }))
              .filter(item => !isOptionEmpty(item.text));

            if (exData.randomizeQuestions) {
              if (sessData.optionsOrder && sessData.optionsOrder[q.id!]) {
                const optOrder = sessData.optionsOrder[q.id!];
                const optOrderMap = new Map<string, number>();
                optOrder.forEach((key, idx) => optOrderMap.set(key, idx));
                validOptions.sort((a, b) => {
                  const idxA = optOrderMap.has(a.key) ? optOrderMap.get(a.key) : 999;
                  const idxB = optOrderMap.has(b.key) ? optOrderMap.get(b.key) : 999;
                  return idxA - idxB;
                });
              } else {
                // Shuffling choices
                validOptions.sort(() => Math.random() - 0.5);
                generatedOptionsOrder[q.id!] = validOptions.map(o => o.key);
                shouldSaveRandomization = true;
              }
            }
            
            return {
              ...q,
              shuffledOptions: validOptions
            } as any;
          });

          // If the randomization order was just generated, save it to DB immediately for session persistence
          if (shouldSaveRandomization) {
            try {
              const updatePayload: Partial<StudentSession> = {};
              if (generatedQuestionOrder.length > 0) {
                updatePayload.questionOrder = generatedQuestionOrder;
              }
              if (Object.keys(generatedOptionsOrder).length > 0) {
                updatePayload.optionsOrder = generatedOptionsOrder;
              }
              if (Object.keys(updatePayload).length > 0) {
                await updateDoc(doc(db, 'student_sessions', user.uid), updatePayload);
              }
            } catch (e) {
              console.error("Gagal menyimpan metadata randomisasi ujian ke DB", e);
            }
          }

          setQuestions(qs);
          if (qs.length > 0) {
            const requestedIdx = sessData.lastQuestionIndex !== undefined ? sessData.lastQuestionIndex : 0;
            const safeIdx = Math.min(Math.max(0, requestedIdx), qs.length - 1);
            setCurrentQuestionIndex(safeIdx);
          } else {
            setCurrentQuestionIndex(0);
          }

          if (calculatedTimeLeft <= 0) {
            setTimeLeft(0);
            setTimeout(() => {
              submitExam();
            }, 500);
          } else {
            setTimeLeft(calculatedTimeLeft);
          }
        }

      } catch (err) {
        console.error("Gagal load data", err);
        setLoadError("Terjadi kesalahan saat memuat ujian. Pastikan koneksi internet stabil.");
      }
    }
    loadData();
  }, [user]);

  // Listen to remote changes on session (for admin warnings/kicks/manual duration changes)
  useEffect(() => {
    if (!user) return;
    let initialized = false;
    const unsub = onSnapshot(doc(db, 'student_sessions', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const dat = { id: docSnap.id, ...docSnap.data() } as StudentSession;
        setSession(dat);
        
        // Match user's warning timestamp upon first mount to prevent showing legacy warnings
        if (!initialized) {
          if (dat.adminWarningTime) {
            setAcknowledgedWarningTime(dat.adminWarningTime);
          }
          initialized = true;
        }

        // Real-time manual duration adjustment from Admin
        if (dat.adjustedRemainingMinutes !== undefined && dat.adjustedAt !== undefined) {
          if (lastProcessedAdjustedAt.current === null || dat.adjustedAt > lastProcessedAdjustedAt.current) {
            lastProcessedAdjustedAt.current = dat.adjustedAt;
            
            // Adjust the duration based on local elapsed time to perfectly sync remaining time
            const elapsedMin = (Date.now() - dat.startTime) / 60000;
            const targetDuration = dat.adjustedRemainingMinutes + elapsedMin;
            
            // Update Firestore with the resolved duration
            updateDoc(doc(db, 'student_sessions', user.uid), {
              duration: targetDuration
            }).catch(e => console.error("Gagal update duration based on adjustment:", e));
          }
        }

        if (dat.status === 'Didiskualifikasi') {
          // Exit fullscreen immediately if disqualified
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
        }
      }
    });
    return () => unsub();
  }, [user]);

  // Listen to exam duration changes
  useEffect(() => {
    if (!session?.examId) return;
    const unsub = onSnapshot(doc(db, 'exams', session.examId), (docSnap) => {
      if (docSnap.exists()) {
        const exData = docSnap.data() as Exam;
        setExam(exData);
      }
    });
    return () => unsub();
  }, [session?.examId]);

  // Recalculate time left whenever session or exam duration changes
  useEffect(() => {
    if (!session?.startTime || !exam) return;
    const activeDuration = typeof session.duration === 'number' ? session.duration : exam.duration;
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
    const totalSecs = Math.round(activeDuration * 60);
    const calculatedTimeLeft = Math.max(0, totalSecs - elapsed);
    
    if (calculatedTimeLeft <= 0) {
      setTimeLeft(0);
      if (session.status !== 'Selesai' && session.status !== 'Didiskualifikasi' && !isSubmittingOrFinished) {
        submitExam();
      }
    } else {
      setTimeLeft(calculatedTimeLeft);
    }
  }, [session?.duration, exam?.duration, session?.startTime, exam, submitExam, isSubmittingOrFinished, session?.status]);

  // Exam Pro Plus: Listeners
  const isUnloading = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnloading.current = true;
      if (user?.uid && session?.examId && timeLeftRef.current > 0) {
        try {
          localStorage.setItem(`cbt_remaining_time_${user.uid}_${session.examId}`, String(timeLeftRef.current));
        } catch (e) {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleBeforeUnload); // Fallback
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleBeforeUnload);
    };
  }, [user?.uid, session?.examId]);

  const recordViolation = async (type: string, message: string) => {
    if (isUnloading.current) return;
    if (isSubmittingOrFinished) return;

    try {
      // Fetch latest session data directly from Firestore for accuracy and to prevent race conditions
      const docRef = doc(db, 'student_sessions', user!.uid);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) return;
      
      const currentSession = docSnap.data() as StudentSession;
      if (currentSession.status === 'Selesai' || currentSession.status === 'Didiskualifikasi') {
        // Exit fullscreen immediately if disqualified
        if (currentSession.status === 'Didiskualifikasi' && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      setWarningMessage(message);
      setTimeout(() => setWarningMessage(''), 5000);

      const newCount = (currentSession.violationsCount || 0) + 1;
      const max = typeof exam?.maxViolations === 'number' ? exam.maxViolations : (settings?.maxViolations !== undefined ? settings.maxViolations : 3);
      const willDisqualify = max > 0 && newCount >= max;

      await addDoc(collection(db, 'violations'), {
        sessionId: currentSession.id || user!.uid,
        studentName: currentSession.studentName || 'Siswa',
        subjectId: currentSession.subjectId || '',
        adminId: currentSession.adminId,
        type,
        status: willDisqualify ? 'Diskualifikasi otomatis' : 'Tercatat',
        timestamp: Date.now()
      });

      if (willDisqualify) {
        await updateDoc(docRef, {
          status: 'Didiskualifikasi',
          violationsCount: newCount,
          endTime: Date.now(),
          wasDisqualified: true
        });

        // Exit fullscreen immediately
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      } else {
        const isFocusLoss = type.includes('Pindah Tab') || type.includes('Membuka aplikasi lain') || type.includes('Fokus hilang') || type.includes('Keluar Fullscreen');
        const nextStatus = isFocusLoss ? 'Tidak Fokus' : 'Melanggar';

        await updateDoc(docRef, {
          status: nextStatus,
          violationsCount: newCount,
          lastActivity: Date.now()
        });
        
        // Reset status briefly, but ONLY if they are not disqualified/done in the meantime
        // and only if it's NOT a focus-loss (so if they are still on another window, they stay 'Tidak Fokus')
        if (!isFocusLoss) {
          setTimeout(async () => {
            try {
              const freshSnap = await getDoc(docRef);
              if (freshSnap.exists()) {
                const freshData = freshSnap.data() as StudentSession;
                if (freshData.status === 'Melanggar') {
                  await updateDoc(docRef, { status: 'Aktif' });
                }
              }
            } catch (err) {
              console.error("Gagal reset status ke Aktif", err);
            }
          }, 5000);
        }
      }
    } catch (err) {
      console.error("Gagal mencatat pelanggaran:", err);
    }
  };

  useEffect(() => {
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || isSubmittingOrFinished) return;

    const handleRegainFocus = async () => {
      try {
        const docRef = doc(db, 'student_sessions', user!.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const freshData = docSnap.data() as StudentSession;
          if (freshData.status === 'Tidak Fokus' || freshData.status === 'Melanggar') {
            await updateDoc(docRef, {
              status: 'Aktif',
              lastActivity: Date.now()
            });
          }
        }
      } catch (err) {
        console.error("Gagal memperbarui status ke Aktif saat regain focus:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        recordViolation('Pindah Tab Browser', 'Terdeteksi pindah tab! Tindakan ini dilarang.');
      } else {
        handleRegainFocus();
      }
    };

    const handleBlur = () => {
      recordViolation('Membuka aplikasi lain', 'Fokus hilang dari ujian! Jangan buka aplikasi lain.');
    };

    const handleFocus = () => {
      handleRegainFocus();
    };

    const handleFullscreenChange = () => {
      const doc = document as any;
      const fullscreenElement = doc.fullscreenElement || doc.webkitFullscreenElement;
      
      // If we are on a device that doesn't actually support true fullscreen, 
      // don't treat the absence of fullscreenElement as a violation.
      const supportsFullscreen = !!(document.documentElement.requestFullscreen || (document.documentElement as any).webkitRequestFullscreen);

      if (!fullscreenElement && supportsFullscreen) {
        setIsFullscreen(false);
        recordViolation('Keluar Fullscreen', 'Keluar dari layar penuh! Ujian harus dikerjakan secara fullscreen.');
      } else {
        setIsFullscreen(true);
        handleRegainFocus();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent common shortcuts and requested violations
      const key = e.key;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;
      const meta = e.metaKey;
      const alt = e.altKey;

      if (
        key === 'Alt' ||
        key === 'Tab' ||
        key === 'Meta' ||
        key === 'Escape' ||
        key === 'F12' || 
        key === 'F5' ||
        key === 'PrintScreen' ||
        (ctrl && (key === 'r' || key === 'R' || key === 'c' || key === 'C' || key === 'v' || key === 'V' || key === 'u' || key === 'U' || key === 't' || key === 'T' || key === 'n' || key === 'N' || key === 'l' || key === 'L')) ||
        (ctrl && shift && (key === 'i' || key === 'I' || key === 'j' || key === 'J' || key === 'n' || key === 'N')) ||
        (meta && (key === 'd' || key === 'D' || key === 'e' || key === 'E' || key === 'Tab')) ||
        (alt && key === 'Tab')
      ) {
        e.preventDefault();
        let type = 'Tombol Shortcut Terlarang';
        
        if (meta && (key === 'd' || key === 'D')) type = 'Shortcut Windows + D (Desktop)';
        else if (meta && (key === 'e' || key === 'E')) type = 'Shortcut Windows + E (Explorer)';
        else if (meta && key === 'Tab') type = 'Shortcut Windows + Tab (Task View)';
        else if (alt && key === 'Tab') type = 'Shortcut Alt + Tab (Pindah Aplikasi)';
        else if (key === 'Alt') type = 'Menekan Tombol Alt';
        else if (key === 'Tab') type = 'Menekan Tombol Tab';
        else if (key === 'Meta') type = 'Membuka Start Menu / Windows';
        else if (key === 'Escape') type = 'Keluar dari Layar Penuh';
        else if (key === 'PrintScreen') type = 'Screenshot Layar';
        else if (key === 'F12' || (ctrl && shift && (key === 'i' || key === 'I'))) type = 'Membuka Developer Tools';
        else if (key === 'F5' || (ctrl && (key === 'r' || key === 'R'))) type = 'Menyegarkan Halaman (Reload)';
        else if (ctrl && (key === 'c' || key === 'C')) type = 'Shortcut Ctrl + C (Copy)';
        else if (ctrl && (key === 'v' || key === 'V')) type = 'Shortcut Ctrl + V (Paste)';
        else if (ctrl && (key === 't' || key === 'T')) type = 'Shortcut Ctrl + T (New Tab)';
        else if (ctrl && (key === 'n' || key === 'N') && !shift) type = 'Shortcut Ctrl + N (New Window)';
        else if (ctrl && shift && (key === 'n' || key === 'N')) type = 'Shortcut Ctrl + Shift + N (Incognito)';
        else if (ctrl && (key === 'l' || key === 'L')) type = 'Shortcut Ctrl + L (Address Bar)';
        else if (ctrl && (key === 'u' || key === 'U')) type = 'Shortcut Ctrl + U (View Source)';

        recordViolation(type, `Aksi terlarang terdeteksi: ${type}`);
      }
    };

    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      recordViolation('Menyalin / Menempel', 'Menyalin atau menempel teks sangat dilarang.');
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('contextmenu', (e) => e.preventDefault()); // no right click

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('contextmenu', (e) => e.preventDefault());
    };
  }, [session, settings, isSubmittingOrFinished, user]);

  // Request Fullscreen
  const requestFullscreen = () => {
    const docEl = document.documentElement as any;
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch((err: any) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
        // If it fails, proceed anyway for user experience
        setIsFullscreen(true);
      });
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
      setIsFullscreen(true);
    } else {
      // No fullscreen API support, proceed anyway
      setIsFullscreen(true);
    }
  };

  // Keep timeLeftRef in sync with state
  const timeLeftRef = useRef<number>(timeLeft);
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  // Timer & Heartbeat
  useEffect(() => {
    if (!session || session.status === 'Selesai' || session.status === 'Didiskualifikasi' || isSubmittingOrFinished) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1;
        timeLeftRef.current = Math.max(0, next);
        if (next <= 0) {
          clearInterval(timer);
          submitExam();
          return 0;
        }
        return next;
      });
    }, 1000);

    const heartbeat = setInterval(() => {
      const curSecs = timeLeftRef.current;
      if (user?.uid) {
        updateDoc(doc(db, 'student_sessions', user.uid), {
          lastActivity: Date.now(),
          remainingSeconds: curSecs
        }).catch(()=>{});
        if (session.examId) {
          try {
            localStorage.setItem(`cbt_remaining_time_${user.uid}_${session.examId}`, String(curSecs));
          } catch (e) {}
        }
      }
    }, 5000); // every 5s for high precision

    return () => { clearInterval(timer); clearInterval(heartbeat); };
  }, [session?.status, session?.examId, user?.uid, isFullscreen, isSubmittingOrFinished, submitExam]);

  // Handle question change and persistence
  const changeQuestion = async (newIndex: number) => {
    setCurrentQuestionIndex(newIndex);
    if (user) {
      try {
        await updateDoc(doc(db, 'student_sessions', user.uid), {
          lastQuestionIndex: newIndex,
          lastActivity: Date.now(),
          remainingSeconds: timeLeftRef.current
        });
      } catch (e) {
        console.error("Gagal simpan progress soal", e);
      }
    }
  };

  const handleAnswer = async (qId: string, ans: string) => {
    const newAnswers = { ...answersRef.current, [qId]: ans };
    setAnswers(newAnswers);
    answersRef.current = newAnswers;

    // Backup answers locally in case of electricity / connection loss (scoped by student UID)
    if (session?.examId && user?.uid) {
      localStorage.setItem(`cbt_answers_${user.uid}_${session.examId}`, JSON.stringify(newAnswers));
      localStorage.setItem(`cbt_remaining_time_${user.uid}_${session.examId}`, String(timeLeftRef.current));
    }

    // Auto save answers immediately for safety
    try {
      await updateDoc(doc(db, 'student_sessions', user!.uid), {
        answers: newAnswers,
        remainingSeconds: timeLeftRef.current,
        lastActivity: Date.now()
      });
    } catch(e) { 
      console.error("Gagal simpan jawaban sementara ke server, tersimpan lokal."); 
    }
  };

  const formatTime = (secs: number) => {
    const cleanSecs = Math.max(0, Math.floor(secs));
    const h = Math.floor(cleanSecs / 3600);
    const m = Math.floor((cleanSecs % 3600) / 60);
    const s = cleanSecs % 60;
    if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentQ = questions[currentQuestionIndex];

  useEffect(() => {
    // Run comprehensive math rendering on current question and options
    const render = () => {
      renderMathInContainers('.ql-editor');
    };

    render();
    const frameId = requestAnimationFrame(render);
    const timerId = setTimeout(render, 50);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [currentQuestionIndex, questions, currentQ]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border">
          <div className="w-20 h-20 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-6">
            <ShieldAlert className="w-10 h-10" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Akses Ditolak</h2>
          <p className="text-slate-500 mb-6 text-sm">{loadError}</p>
          <button onClick={async () => { await logout(); navigate('/'); }} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2 rounded-lg font-medium transition-colors w-full">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  if (!session || !exam) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-900"><Loader2 className="w-8 h-8 text-white animate-spin" /></div>;
  }

  if (session.status === 'Selesai' || session.status === 'Didiskualifikasi') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border top-4">
          <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-6 ${session.status === 'Didiskualifikasi' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
            {session.status === 'Didiskualifikasi' ? <ShieldAlert className="w-10 h-10" /> : <Save className="w-10 h-10" />}
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">
            {session.status === 'Didiskualifikasi' ? 'Diskualifikasi Peserta' : 'Ujian Selesai'}
          </h2>
          <p className="text-slate-500 mb-6 font-medium leading-relaxed">
            {session.status === 'Didiskualifikasi' 
              ? 'Sesi ujian Anda telah dihentikan oleh pengawas karena terdeteksi adanya pelanggaran tata tertib ujian.' 
              : 'Terima kasih, pengerjaan ujian Anda telah selesai dan seluruh jawaban Anda telah berhasil disimpan secara aman di server.'}
          </p>

          {session.status === 'Selesai' && exam.showScoreToStudent && (
            <div className="mb-6 bg-slate-50 rounded-xl p-5 border border-slate-200/60 text-center animate-in zoom-in-95 duration-300">
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5 font-sans">
                Skor Akhir Anda
              </div>
              <div className="text-5xl font-black text-blue-600 font-mono tracking-tight">
                {session.score !== undefined ? (typeof session.score === 'number' ? session.score.toFixed(1) : parseFloat(session.score).toFixed(1)) : '0.0'}
              </div>
              <div className="flex items-center justify-center gap-5 mt-4 pt-4 border-t border-slate-200 text-xs font-bold text-slate-600">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"></span>
                  <span>Benar: {session.correctCount ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-200"></span>
                  <span>Salah: {session.wrongCount ?? 0}</span>
                </div>
              </div>
            </div>
          )}
          <button onClick={async () => { await logout(); navigate('/'); }} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors w-full">
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  if (!isFullscreen && session.status !== 'Selesai' && session.status !== 'Didiskualifikasi') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <Maximize className="w-16 h-16 text-blue-400 mb-6" />
        <h1 className="text-3xl font-bold mb-4">Mulai Ujian</h1>
        <p className="max-w-md text-slate-300 mb-8 leading-relaxed">
          Ujian ini menggunakan sistem keamanan Exam Pro Plus. Layar akan diubah menjadi fullscreen. 
          Anda dilarang berpindah tab, membuka aplikasi lain, keluar layar penuh, atau melakukan kombinasi tombol terlarang.
        </p>
        <button 
          onClick={requestFullscreen}
          className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-lg font-medium text-lg shadow-lg hover:shadow-xl transition-all"
        >
          Masuk ke Mode Layar Penuh
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-screen overflow-hidden bg-slate-50 flex flex-col select-none">

      {/* Admin Warning Modal Overlay */}
      {session && session.adminWarningTime && session.adminWarningTime > acknowledgedWarningTime && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] max-w-md w-full border border-red-100 p-6 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4 shadow-sm animate-bounce">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-extrabold text-red-600 uppercase tracking-widest mb-1 font-sans">
              Teguran Kedisiplinan
            </h3>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-4">
              Pesan Dari Pengawas Ujian
            </p>
            <div className="w-full bg-red-50/50 rounded-xl p-4 border border-red-100/50 mb-6 text-left">
              <p className="text-xs text-red-700 leading-relaxed font-semibold">
                {session.adminWarningMessage || "Mohon penuhi instruksi keselamatan ujian agar pengerjaan tetap aman!"}
              </p>
            </div>
            <button 
              onClick={() => {
                setAcknowledgedWarningTime(session.adminWarningTime!);
              }}
              className="w-full py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-sm tracking-wider uppercase rounded-xl transition-all shadow-md active:scale-95 cursor-pointer font-sans"
            >
              Oke, Saya Mengerti
            </button>
          </div>
        </div>
      )}
      
      {/* Alert Overlay */}
      <AnimatePresence>
        {warningMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center space-x-3 w-max max-w-[90vw]"
          >
            <AlertTriangle className="w-6 h-6 animate-pulse" />
            <span className="font-bold">{warningMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.4)] max-w-md w-full border border-slate-100 p-6 flex flex-col items-center animate-in scale-in duration-200">
            <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-4 shadow-sm">
              <Save className="w-8 h-8 animate-pulse" />
            </div>
            
            <h3 className="text-lg font-extrabold text-slate-800 uppercase tracking-wider mb-2 font-sans">
              {Object.keys(answers).length < questions.length ? 'Peringatan: Soal Belum Selesai' : 'Selesaikan Ujian?'}
            </h3>
            
            <p className="text-xs text-slate-500 mb-6 text-center leading-relaxed font-medium">
              {Object.keys(answers).length < questions.length 
                ? `Terdapat ${questions.length - Object.keys(answers).length} soal yang belum Anda jawab. Apakah Anda yakin ingin mengakhiri sesi ujian ini sekarang?`
                : 'Apakah Anda yakin ingin mengakhiri sesi ujian ini? Semua jawaban Anda telah tersimpan secara otomatis di server sistem.'}
              {" "}Anda tidak dapat mengubah jawaban setelah menyelesaikan ujian.
            </p>

            {/* Stats Summary */}
            <div className="w-full bg-slate-50 rounded-xl p-4 border border-slate-200/60 mb-6 font-sans">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Total Soal</p>
                  <p className="text-lg font-black text-slate-700">{questions.length}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Sudah Dijawab</p>
                  <p className="text-lg font-black text-green-600">{Object.keys(answers).length}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 w-full">
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer font-sans"
              >
                Kembali
              </button>
              <button 
                onClick={async () => {
                  setShowConfirmModal(false);
                  await submitExam();
                }}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 cursor-pointer font-sans"
              >
                Selesai & Kirim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Network Connectivity Error Modal */}
      {showSubmitErrorModal && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.5)] max-w-sm w-full border border-slate-100 p-6 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className="w-16 h-16 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4 border border-red-100">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            
            <h3 className="text-base font-extrabold text-red-600 uppercase tracking-wider mb-2 font-sans">
              Koneksi Terganggu / Hilang
            </h3>
            
            <p className="text-xs text-slate-500 mb-6 leading-relaxed font-sans font-medium">
              Sinyal atau koneksi internet pada perangkat Anda sedang terganggu. 
              <br className="mb-2"/>
              <strong>Tenang, seluruh jawaban Anda aman dan tidak hilang.</strong> 
              <br className="mb-2"/>
              Silakan periksa koneksi Wi-Fi/data seluler Anda, lalu tekan tombol <strong>Coba Lagi</strong> untuk mengirim ulang hasil ujian Anda.
            </p>

            <div className="flex gap-3 w-full">
              <button 
                onClick={() => setShowSubmitErrorModal(false)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer font-sans"
              >
                Tutup
              </button>
              <button 
                onClick={async () => {
                  setShowSubmitErrorModal(false);
                  await submitExam();
                }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 cursor-pointer font-sans"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-2 shrink-0 flex items-center justify-between sticky top-0 z-40">
        <div className="flex flex-col justify-center">
          <h1 className="font-bold text-slate-800 text-sm leading-tight">{exam.title}</h1>
          <div className="flex items-center flex-wrap gap-2 mt-1">
            <div className="flex items-center bg-blue-600 text-white px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider shadow-3xs">
              {session.studentName}
            </div>
            <div className="flex items-center bg-slate-800 text-white px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider shadow-3xs">
              {session.className}
            </div>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight ml-1 mr-2">
              {subjectName}
            </span>
            {isOnline ? (
              <div className="flex items-center bg-emerald-500 text-white px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-widest leading-none shadow-3xs transition-all duration-300">
                <span className="w-1.5 h-1.5 bg-white rounded-full mr-1 animate-pulse"></span>
                <Wifi className="w-3 h-3 mr-1" />
                <span>ONLINE</span>
              </div>
            ) : (
              <div className="flex items-center bg-rose-500 text-white px-2 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-widest leading-none shadow-3xs animate-bounce border border-rose-600">
                <span className="w-1.5 h-1.5 bg-white rounded-full mr-1 animate-ping"></span>
                <WifiOff className="w-3 h-3 mr-1" />
                <span>OFFLINE (TERPUTUS)</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3 text-slate-700">
          <div className="font-mono text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full font-medium">
            {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="flex items-center text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border border-red-100">
            <ShieldAlert className="w-3.5 h-3.5 mr-1" />
            <span>Pelanggaran: {session.violationsCount}</span>
          </div>
          <div className={`flex items-center px-3 py-1 rounded border ${timeLeft < 300 ? 'bg-red-50 border-red-200 text-red-700 animate-pulse' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            <Clock className="w-4 h-4 mr-1.5" />
            <span className="font-mono stroke-2 font-bold text-sm tracking-widest">{formatTime(timeLeft)}</span>
          </div>
          <button
            onClick={() => setShowConfirmModal(true)}
            className="flex items-center bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg px-3 py-1.5 shadow-sm transition-all duration-150 cursor-pointer"
            title="Kumpulkan ujian sekarang"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            <span>Kumpulkan</span>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full max-w-4xl mx-auto p-4 md:p-6 flex flex-col min-h-full">
            {currentQ ? (
               <div className="flex-1 flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                     <span className="bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Soal No. {currentQuestionIndex + 1}</span>
                     <span className="text-slate-400 text-[10px] font-bold uppercase">Bobot: {currentQ.weight}</span>
                  </div>
                  
                                     {currentQ.type === 'listening' && audioItem && (
                      <div className="mb-6 bg-blue-50/80 border border-blue-200 rounded-xl p-4 flex flex-col gap-3 shadow-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                              🎧
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wide">Audio Listening: {audioItem.name}</h4>
                              <p className="text-[10px] text-blue-600 font-medium">
                                {audioItem.allowRepeat === 'Ya' ? 'Pengulangan Diizinkan (Bisa diputar kembali)' : 'Sekali Putar (Audio hanya dapat diputar sekali)'}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div>
                          <CustomAudioPlayer 
                            audioItem={audioItem} 
                            hasPlayedAudio={hasPlayedAudio} 
                            setHasPlayedAudio={setHasPlayedAudio} 
                          />
                        </div>
                      </div>
                   )}
                   
                   <div dir="auto" className="prose max-w-none text-slate-800 text-sm font-medium mb-6 leading-relaxed ql-editor px-0 py-0" dangerouslySetInnerHTML={{ __html: formatHTML(currentQ.question) }} />

                  {currentQ.type === 'essay' ? (
                     <div className="mt-4 flex flex-col flex-1">
                       <div className="flex items-center justify-between mb-2">
                         <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                           <span className="w-1.5 h-1.5 bg-purple-500 rounded-full mr-1.5 animate-pulse"></span>
                           Jawaban Uraian Anda:
                         </label>
                         <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 rounded px-1.5 py-0.5 font-bold uppercase">
                           Sistem Essay
                         </span>
                       </div>
                       <textarea
                         rows={8}
                         value={answers[currentQ.id!] || ''}
                         onChange={(e) => handleAnswer(currentQ.id!, e.target.value)}
                         placeholder="Ketikkan jawaban lengkap Anda secara detail di sini..."
                         className="w-full p-4 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-y font-medium text-slate-800 leading-relaxed shadow-xs transition-all animate-in fade-in"
                       />
                       <p className="text-[10px] text-slate-400 mt-1.5 italic font-medium">Jawaban Anda disimpan secara otomatis saat Anda mengetik atau berpindah soal.</p>
                     </div>
                  ) : currentQ.type === 'isian_singkat' ? (
                     <div className="mt-4 flex flex-col flex-1">
                       <div className="flex items-center justify-between mb-2">
                         <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                           <span className="w-1.5 h-1.5 bg-amber-550 rounded-full mr-1.5 animate-pulse animate-duration-1000"></span>
                           Jawaban Singkat Anda:
                         </label>
                         <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-250 rounded px-1.5 py-0.5 font-bold uppercase">
                           Isian Singkat
                         </span>
                       </div>
                       <input
                         type="text"
                         value={answers[currentQ.id!] || ''}
                         onChange={(e) => handleAnswer(currentQ.id!, e.target.value)}
                         placeholder="Ketikkan jawaban singkat Anda di sini..."
                         className="w-full p-4 text-sm bg-white border border-slate-200 rounded-xl outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-bold text-slate-800 shadow-xs transition-all animate-in fade-in"
                       />
                       <p className="text-[10px] text-slate-400 mt-1.5 italic font-medium">Jawaban Anda disimpan secara otomatis saat Anda mengetik atau berpindah soal.</p>
                     </div>
                  ) : currentQ.type === 'pilihan_ganda_kompleks' ? (
                     <div className="space-y-2 mt-auto">
                       <div className="flex items-center justify-between mb-3">
                          <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                             <span className="w-1.5 h-1.5 bg-teal-500 rounded-full mr-1.5 animate-pulse"></span>
                             Pilih Jawaban Anda (Bisa Lebih Dari 1):
                          </label>
                          <span className="text-[10px] font-bold uppercase border rounded px-1.5 py-0.5 bg-teal-50 text-teal-700 border-teal-100">
                             PG Kompleks
                          </span>
                       </div>
                       {((currentQ as any).shuffledOptions || []).map((optItem: any, idx: number) => {
                         const displayLabel = ['A', 'B', 'C', 'D', 'E'][idx];
                         const selectedKeys = (answers[currentQ.id!] || '').split(',').map(s => s.trim()).filter(Boolean);
                         const isSelected = selectedKeys.includes(optItem.key);
                         
                         return (
                           <label 
                             key={optItem.key}
                             className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'border-teal-500 bg-teal-50 shadow-sm' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50'}`}
                           >
                             <input 
                               type="checkbox" 
                               className="sr-only" 
                               checked={isSelected}
                               onChange={() => {
                                 const currentVal = answers[currentQ.id!] || '';
                                 const currentKeys = currentVal.split(',').map(s => s.trim()).filter(Boolean);
                                 let nextKeys: string[];
                                 if (currentKeys.includes(optItem.key)) {
                                   nextKeys = currentKeys.filter(k => k !== optItem.key);
                                 } else {
                                   nextKeys = [...currentKeys, optItem.key].sort();
                                 }
                                 handleAnswer(currentQ.id!, nextKeys.join(','));
                               }}
                             />
                             <span className={`shrink-0 w-6 h-6 rounded border flex items-center justify-center font-bold text-[11px] mr-3 ${isSelected ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 text-slate-500'}`}>
                               {displayLabel}
                             </span>
                             <div dir="auto" className="flex-1 text-sm text-slate-700 ql-editor p-0 [&_p]:m-0 [&_p]:p-0 leading-6" dangerouslySetInnerHTML={{ __html: formatHTML(optItem.text) }} />
                           </label>
                         );
                       })}
                     </div>
                  ) : (
                    <div className="space-y-2 mt-auto">
                      <div className="flex items-center justify-between mb-3">
                         <label className="text-xs font-bold text-slate-500 uppercase flex items-center">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse"></span>
                            Pilih Jawaban Anda:
                         </label>
                         <span className="text-[10px] font-bold uppercase border rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 border-blue-100">
                            {currentQ.type === 'listening' ? 'Listening' : 'Pilihan Ganda'}
                         </span>
                      </div>
                      {((currentQ as any).shuffledOptions || []).map((optItem: any, idx: number) => {
                        const displayLabel = ['A', 'B', 'C', 'D', 'E'][idx];
                        const isSelected = answers[currentQ.id!] === optItem.key;
                        
                        return (
                          <label 
                            key={optItem.key}
                            className={`flex items-start p-3 rounded-lg border cursor-pointer transition-all ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'}`}
                          >
                            <input 
                              type="radio" 
                              className="sr-only" 
                              checked={isSelected}
                              onChange={() => handleAnswer(currentQ.id!, optItem.key)}
                            />
                            <span className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center font-bold text-[11px] mr-3 ${isSelected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 text-slate-500'}`}>
                              {displayLabel}
                            </span>
                            <div dir="auto" className="flex-1 text-sm text-slate-700 ql-editor p-0 [&_p]:m-0 [&_p]:p-0 leading-6" dangerouslySetInnerHTML={{ __html: formatHTML(optItem.text) }} />
                          </label>
                        );
                      })}
                    </div>
                  )}
               </div>
            ) : (
               <div className="flex-1 flex items-center justify-center text-slate-500 text-xs font-bold uppercase">
                  Tidak ada soal ditemukan.
               </div>
            )}
            
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
               <button 
                 disabled={currentQuestionIndex === 0}
                 onClick={() => changeQuestion(currentQuestionIndex - 1)}
                 className="px-4 py-2 rounded border border-slate-300 text-slate-600 text-[11px] font-bold uppercase tracking-wider hover:bg-slate-50 disabled:opacity-50 transition-colors"
               >
                 Soal Sebelumnya
               </button>
               {currentQuestionIndex < questions.length - 1 ? (
                 <button 
                  onClick={() => changeQuestion(currentQuestionIndex + 1)}
                  className="px-4 py-2 rounded border border-blue-600 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-blue-700 transition-colors"
                 >
                   Soal Selanjutnya
                 </button>
               ) : (
                  <button 
                  onClick={() => { setShowConfirmModal(true) }}
                  className="px-4 py-2 rounded bg-green-600 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-green-700 transition-colors shadow-sm"
                 >
                   Selesai Ujian
                 </button>
               )}
            </div>
          </div>
        </div>

        {/* Sidebar Nav */}
        <div className="w-64 bg-white border-l border-slate-200 overflow-y-auto shrink-0 flex flex-col hidden lg:flex">
           <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col space-y-1">
             <h3 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider">Navigasi Soal</h3>
             <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1 relative">
                <div className="absolute top-0 left-0 bottom-0 bg-blue-500 transition-all" style={{width: `${questions.length ? (Object.keys(answers).length / questions.length) * 100 : 0}%`}} />
             </div>
             <span className="text-[10px] font-bold text-slate-500 text-right">{Object.keys(answers).length} / {questions.length} Dijawab</span>
           </div>
           <div className="p-3 grid grid-cols-5 gap-1.5 auto-rows-max">
             {questions.map((q, idx) => {
               const isAnswered = !!answers[q.id!];
               const isCurrent = currentQuestionIndex === idx;
               
               return (
                 <button
                   key={q.id}
                   onClick={() => changeQuestion(idx)}
                   className={`h-8 rounded flex items-center justify-center font-bold text-[11px] transition-colors ${
                     isCurrent 
                       ? 'ring-1 ring-offset-1 ring-blue-500 bg-blue-600 text-white shadow-sm' 
                       : isAnswered 
                         ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                         : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                   }`}
                 >
                   {idx + 1}
                 </button>
               )
             })}
           </div>
           <div className="hidden mt-auto p-3 border-t border-slate-100 bg-slate-50 flex flex-col gap-1.5 text-center">
             <button
               onClick={() => setShowConfirmModal(true)}
               className="w-full py-2.5 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
             >
               <Save size={14} />
               Kumpulkan Ujian
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}
