import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType, auth } from '../lib/firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Setting, Subject, Exam, StudentSession, StudentRecord } from '../types';
import { ShieldAlert, UserPlus, Lock, AppWindow, GraduationCap, ArrowRight, Loader2, UserCircle, KeyRound, CheckCircle2, Link2, Key, Info, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import brandLogo from '../assets/images/logo1.png';
import { getStudentName, getStudentPin } from '../utils/studentUtils';

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const examIdFromUrl = searchParams.get('e');
  const codeFromUrl = searchParams.get('c');
  const hasStudentLink = !!(examIdFromUrl || codeFromUrl);

  const { user, isAdmin, loginAsStudent, resetPassword, checkEmailExists, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'student' | 'admin' | 'forgot_password'>('student');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Always force logout when visiting the root login page 
  // to ensure a fresh session and default to student portal.
  useEffect(() => {
    // If they did not just sign in and they hit the landing page, 
    // force clean their session so they really are logged out.
    if (!sessionStorage.getItem('just_logged_in_admin') && !sessionStorage.getItem('just_logged_in_student')) {
      logout().catch(console.error);
    }
  }, []);

  // Data
  const [setting, setSetting] = useState<Setting | null>(null);
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeExams, setActiveExams] = useState<Exam[]>([]);
  const [classesList, setClassesList] = useState<{id: string, name: string}[]>([]);

  // Form State
  const [studentName, setStudentName] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  const [showStudentPassword, setShowStudentPassword] = useState(false);
  const [examToken, setExamToken] = useState('');
  const [isLoggingInStudent, setIsLoggingInStudent] = useState(false);
  
  // Student selection dropdown state
  const [availableStudents, setAvailableStudents] = useState<string[]>([]);
  const [rawStudentRecords, setRawStudentRecords] = useState<(string | StudentRecord)[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchDropdownQuery, setSearchDropdownQuery] = useState('');
  
  // Admin Form State
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');

  // Specific Exam info based on URL
  const [linkedExam, setLinkedExam] = useState<Exam | null>(null);
  const [linkedSubjectName, setLinkedSubjectName] = useState<string>('');

  useEffect(() => {
    let unsubSettings: () => void;
    let unsubExams: () => void;
    let unsubClasses: () => void;
    let unsubSubjects: () => void;

    // Fetch Active Exams
    const examsQuery = query(collection(db, 'exams'), where('isActive', '==', true));
    unsubExams = onSnapshot(examsQuery, (examsSnap) => {
      const examsData = examsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
      setActiveExams(examsData);
    }, (err) => console.error(err));

    // Fetch Classes
    unsubClasses = onSnapshot(collection(db, 'classes'), (classesSnap) => {
      const uniqueClasses = Array.from(new Map(classesSnap.docs.map(d => [d.data().name, { id: d.id, name: d.data().name }])).values());
      const sortedClasses = uniqueClasses.sort((a, b) => a.name.localeCompare(b.name));
      setClassesList(sortedClasses);
    }, (err) => console.error(err));

    // Fetch Subjects
    unsubSubjects = onSnapshot(collection(db, 'subjects'), (subjectsSnap) => {
      const rawSubjects = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject));
      setAllSubjects(rawSubjects);
      const uniqueSubjects = Array.from(new Map(rawSubjects.map(d => [d.name, d])).values());
      const sortedSubjects = uniqueSubjects.sort((a: any, b: any) => a.name.localeCompare(b.name));
      setSubjects(sortedSubjects as Subject[]);
    }, (err) => console.error(err));

    return () => {
      if (unsubExams) unsubExams();
      if (unsubClasses) unsubClasses();
      if (unsubSubjects) unsubSubjects();
    };
  }, []);

  // Check if entered token matches an active exam
  const matchingActiveExam = Array.isArray(activeExams)
    ? activeExams.find(ex => ex.isActive && ex.activeToken && ex.activeToken.toUpperCase() === examToken.trim().toUpperCase())
    : undefined;

  const isTokenValidAndActive = Boolean(
    matchingActiveExam && (!linkedExam || matchingActiveExam.id === linkedExam.id)
  );

  // Automatically reset studentName, studentPassword, and close dropdown if token becomes invalid/inactive
  useEffect(() => {
    if (!isTokenValidAndActive) {
      setStudentName('');
      setStudentPassword('');
      setIsDropdownOpen(false);
      setSearchDropdownQuery('');
    }
  }, [isTokenValidAndActive]);

  // Update linkedExam when data loaded
  useEffect(() => {
    const targetCode = codeFromUrl || examIdFromUrl;
    if (targetCode && activeExams.length > 0) {
      const ex = Array.isArray(activeExams) ? activeExams.find(e => 
         e.id === targetCode || 
         e.shortCode === targetCode || 
         e.id?.substring(0, 6) === targetCode
      ) : undefined;
      if (ex) {
        setLinkedExam(ex);
        const subj = Array.isArray(allSubjects) ? allSubjects.find(s => s.id === ex.subjectId) : undefined;
        if (subj) setLinkedSubjectName(subj.name);
      }
    }
  }, [examIdFromUrl, codeFromUrl, activeExams, allSubjects]);

  // Sync Settings when Admin is identified
  useEffect(() => {
    let adminId = '';
    
    // 1. Check linkedExam (from URL)
    if (linkedExam?.adminId) {
      adminId = linkedExam.adminId;
    } 
    // 2. Check token entry
    else if (examToken && examToken.length >= 4) {
      const matchingExam = Array.isArray(activeExams) ? activeExams.find(ex => ex.activeToken.toUpperCase() === examToken.toUpperCase()) : undefined;
      if (matchingExam?.adminId) {
        adminId = matchingExam.adminId;
      }
    }

    if (adminId) {
      const qSettings = query(collection(db, 'settings'), where('adminId', '==', adminId));
      const unsub = onSnapshot(qSettings, (snap) => {
        if (!snap.empty) {
          setSetting(snap.docs[0].data() as Setting);
        }
      });
      return () => unsub();
    }
  }, [linkedExam?.adminId, examToken, activeExams]);

  // Background token auto-reset check
  useEffect(() => {
    if (!user || !isAdmin || activeExams.length === 0) return;

    const generateNewToken = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let t = '';
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 100) {
        t = '';
        for (let i = 0; i < 6; i++) {
          t += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        isUnique = !Array.isArray(activeExams) || !activeExams.some(e => e.isActive && e.activeToken === t);
        attempts++;
      }
      return t;
    };

    const checkAndResetTokens = async () => {
      let changed = false;
      const newList = [...activeExams];

      for (let i = 0; i < newList.length; i++) {
        const exam = newList[i];
        if (exam.adminId === user.uid && exam.isActive && exam.autoResetInterval && exam.autoResetInterval !== 'manual') {
          const intervalMinutes = parseInt(exam.autoResetInterval, 10);
          if (!isNaN(intervalMinutes)) {
            const lastUpdated = exam.tokenUpdatedAt || 0;
            const elapsedMs = Date.now() - lastUpdated;
            const limitMs = intervalMinutes * 60 * 1000;

            if (elapsedMs >= limitMs) {
              const newToken = generateNewToken();
              const now = Date.now();
              try {
                await updateDoc(doc(db, 'exams', exam.id!), {
                  activeToken: newToken,
                  tokenUpdatedAt: now
                });
                newList[i] = {
                  ...exam,
                  activeToken: newToken,
                  tokenUpdatedAt: now
                };
                changed = true;
              } catch (err) {
                console.error("Gagal melakukan reset otomatis token:", err);
              }
            }
          }
        }
      }

      if (changed) {
        setActiveExams(newList);
      }
    };

    checkAndResetTokens();
    const interval = setInterval(checkAndResetTokens, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [activeExams, user, isAdmin]);

  // Helper to normalize class names for comparison (removes redundant spaces, punctuation, roman numerals)
  const normalizeClassKey = (str: string): string => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[\u00A0\s]+/g, ' ')
      .replace(/[_\-./\\]/g, ' ')
      .replace(/\bxi\b/g, '11')
      .replace(/\bxii\b/g, '12')
      .replace(/\bx\b/g, '10')
      .replace(/\s+/g, '')
      .trim();
  };

  // Fetch student lists based on valid and active token
  useEffect(() => {
    if (!isTokenValidAndActive || !matchingActiveExam) {
      setAvailableStudents([]);
      return;
    }

    const currentExam = matchingActiveExam;

    if (currentExam.targetClass) {
      getDocs(collection(db, 'classes')).then((snap) => {
        const targetRaw = (currentExam.targetClass || '').trim();
        const targetClean = targetRaw.toLowerCase();
        const targetNorm = normalizeClassKey(targetRaw);
        const targetNoKelas = targetNorm.replace(/^kelas/, '');

        let bestDoc: any = null;
        let bestScore = -1;

        for (const d of snap.docs) {
          const cData = d.data();
          const cName = (cData.name || '').trim();
          const cClean = cName.toLowerCase();
          const cNorm = normalizeClassKey(cName);
          const cNoKelas = cNorm.replace(/^kelas/, '');
          const students = Array.isArray(cData.students) ? cData.students : [];
          const hasStudents = students.length > 0;
          const isSameAdmin = currentExam.adminId && cData.adminId === currentExam.adminId;

          let score = 0;

          // 1. Direct Document ID Match
          if (d.id === targetRaw) {
            score = 1000;
          }
          // 2. Strict String Match (Case-insensitive trimmed)
          else if (cClean === targetClean && cClean.length > 0) {
            score = 900;
          }
          // 3. Normalized Match (Handles double spaces, punctuation, roman numerals: XI MIPA 2 == 11 MIPA 2)
          else if (cNorm === targetNorm && cNorm.length > 0) {
            score = 800;
          }
          // 4. Normalized without "kelas" prefix (e.g. Kelas 11 MIPA 2 == 11 MIPA 2)
          else if (cNoKelas === targetNoKelas && cNoKelas.length > 0) {
            score = 700;
          }
          // 5. Complete Word Token Set Match (Regardless of order)
          else {
            const targetWords = targetRaw.toLowerCase().split(/[\s_\-./\\]+/).filter(Boolean);
            const cWords = cName.toLowerCase().split(/[\s_\-./\\]+/).filter(Boolean);
            if (targetWords.length > 0 && cWords.length > 0) {
              const allTargetInC = targetWords.every(tw => cWords.includes(tw));
              const allCInTarget = cWords.every(cw => targetWords.includes(cw));
              if (allTargetInC && allCInTarget) {
                score = 600;
              }
            }
          }

          if (score > 0) {
            if (isSameAdmin) score += 50;
            if (hasStudents) score += 20; // Prioritize the document that contains actual students

            if (score > bestScore) {
              bestScore = score;
              bestDoc = d;
            }
          }
        }

        if (bestDoc) {
          const classData = bestDoc.data();
          const rawStudents = (classData.students || []) as (string | StudentRecord)[];
          setRawStudentRecords(rawStudents);
          const studentNames = rawStudents.map(s => getStudentName(s));
          setAvailableStudents([...studentNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
        } else {
          setRawStudentRecords([]);
          setAvailableStudents([]);
        }
      }).catch((err) => {
        console.error("Gagal mengambil siswa:", err);
        setRawStudentRecords([]);
        setAvailableStudents([]);
      });
    } else {
      setRawStudentRecords([]);
      setAvailableStudents([]);
    }
  }, [isTokenValidAndActive, matchingActiveExam]);

  const handleAdminEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmail || !adminPassword) {
      setErrorMessage('Harap isi Email dan Password.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      sessionStorage.setItem('just_logged_in_admin', 'true');
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      setLoading(false);
      navigate('/admin');
    } catch (error: any) {
      const code = error?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        setErrorMessage('Email atau Password yang Anda masukkan tidak sesuai.');
      } else if (code === 'auth/too-many-requests') {
        setErrorMessage('Akses diblokir sementara karena terlalu banyak percobaan login yang gagal. Silakan coba lagi nanti.');
      } else {
        setErrorMessage('Email atau Password salah.');
      }
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setErrorMessage('Harap masukkan alamat email.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      // Per the user request, if the email does not exist, throw an alert.
      const exists = await checkEmailExists(resetEmail);
      if (!exists) {
        setErrorMessage('Email yang dimasukkan tidak terdaftar.');
        setLoading(false);
        return;
      }
      
      await resetPassword(resetEmail);
      setSuccessMessage('Tautan reset password telah dikirim ke email Anda.');
      setResetEmail('');
    } catch (error: any) {
      console.error(error);
      setErrorMessage('Gagal mengirim tautan reset password atau email tidak terdaftar.');
    } finally {
      setLoading(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName || !examToken) {
      setErrorMessage('Harap lengkapi semua data.');
      return;
    }

    const upperName = studentName.trim().toUpperCase();
    
    // Find exam by token first - important to handle case insensitive token entry
    const matchingExamByToken = Array.isArray(activeExams) ? activeExams.find(ex => ex.activeToken.toUpperCase() === examToken.trim().toUpperCase()) : undefined;

    if (!matchingExamByToken) {
      setErrorMessage('Token ujian salah atau tidak valid. Silakan hubungi pengawas.');
      return;
    }

    // If they used a link to specific exam, verify the token matches that exam
    if (linkedExam && matchingExamByToken.id !== linkedExam.id) {
       setErrorMessage('Token ujian tidak cocok dengan link ujian ini.');
       return;
    }

    const matchingExam = matchingExamByToken;

    // Validate Student Password / PIN if required for this exam schedule
    const isPinRequired = matchingExam.requireStudentPassword !== false;
    if (isPinRequired) {
      if (!studentPassword || !studentPassword.trim()) {
        setErrorMessage('Harap masukkan Password / PIN Siswa.');
        return;
      }

      let targetRecord: string | StudentRecord | undefined;
      if (rawStudentRecords.length > 0) {
        targetRecord = rawStudentRecords.find(s => getStudentName(s) === upperName);
      }

      if (!targetRecord && matchingExam.targetClass) {
        try {
          const snap = await getDocs(collection(db, 'classes'));
          for (const d of snap.docs) {
            const cData = d.data();
            if ((cData.name || '').trim().toLowerCase() === (matchingExam.targetClass || '').trim().toLowerCase()) {
              const students = (cData.students || []) as (string | StudentRecord)[];
              targetRecord = students.find(s => getStudentName(s) === upperName);
              if (targetRecord) break;
            }
          }
        } catch (err) {
          console.error("Gagal verifikasi PIN dari database kelas:", err);
        }
      }

      const expectedPin = getStudentPin(targetRecord);
      if (studentPassword.trim() !== expectedPin.trim()) {
        setErrorMessage('Password / PIN Siswa salah. Silakan periksa kembali PIN Anda.');
        return;
      }
    }

    try {
      setLoading(true);
      setIsLoggingInStudent(true);
      setErrorMessage('');

      // Check for an existing session with exact same candidate name and exam (using single-field query to avoid composite index requirement on other devices)
      const sessionQuery = query(
        collection(db, 'student_sessions'),
        where('examId', '==', matchingExam.id)
      );
      
      const sessionSnap = await getDocs(sessionQuery);
      const matchingDocs = sessionSnap.docs.filter(d => {
        const data = d.data() as StudentSession;
        return data.studentName === upperName && data.adminId === matchingExam.adminId;
      });
      let targetUid = '';
      let isResume = false;
      let existingSessionData: StudentSession | null = null;

      if (matchingDocs.length > 0) {
        // Filter out sessions that were hidden/superseded
        const visibleDocs = matchingDocs.filter(d => !(d.data() as StudentSession).hiddenFromMonitor);
        const docsToEvaluate = visibleDocs.length > 0 ? visibleDocs : matchingDocs;

        // 1. Strict finished check: if ANY existing session doc for this candidate is finished
        const hasFinished = docsToEvaluate.some(d => (d.data() as StudentSession).status === 'Selesai');
        if (hasFinished) {
          setErrorMessage('Anda sudah menyelesaikan ujian ini sebelumnya.');
          setLoading(false);
          setIsLoggingInStudent(false);
          return;
        }

        // 2. Strict disqualification check: if ANY existing active session doc for this candidate is disqualified
        const disqualifiedDoc = docsToEvaluate.find(d => (d.data() as StudentSession).status === 'Didiskualifikasi');
        if (disqualifiedDoc) {
          setErrorMessage('Akun Anda telah didiskualifikasi dari ujian ini. Silakan hubungi pengawas untuk memulihkan akses.');
          setLoading(false);
          setIsLoggingInStudent(false);
          return;
        }

        // Sort sessions to prioritize active status, then latest activity time
        const sortedDocs = [...docsToEvaluate].sort((a, b) => {
          const sa = a.data() as StudentSession;
          const sb = b.data() as StudentSession;
          
          const timeA = sa.lastActivity || sa.startTime || 0;
          const timeB = sb.lastActivity || sb.startTime || 0;
          return timeB - timeA;
        });

        const docSnap = sortedDocs[0];
        existingSessionData = docSnap.data() as StudentSession;
        targetUid = docSnap.id;
        isResume = true;

        // Validation for resuming
        if (existingSessionData.status === 'Selesai') {
          setErrorMessage('Anda sudah menyelesaikan ujian ini sebelumnya.');
          setLoading(false);
          setIsLoggingInStudent(false);
          return;
        }

        if (existingSessionData.status === 'Didiskualifikasi') {
          setErrorMessage('Akun Anda telah didiskualifikasi dari ujian ini. Silakan hubungi pengawas untuk memulihkan akses.');
          setLoading(false);
          setIsLoggingInStudent(false);
          return;
        }

        let currentDeviceId = localStorage.getItem('cbt_device_id');
        if (!currentDeviceId) {
          currentDeviceId = Math.random().toString(36).substring(2, 15);
          localStorage.setItem('cbt_device_id', currentDeviceId);
        }

        // Multi-device access check:
        // If teacher granted permission after disqualification (wasDisqualified === true or deviceId is null)
        // OR if lastActivity is 0/offline, allow logging in on ANY device.
        const isRestoredOrInactive = existingSessionData.wasDisqualified || 
          !existingSessionData.deviceId || 
          existingSessionData.lastActivity === 0 || 
          (Date.now() - existingSessionData.lastActivity) > 30000;

        if (!isRestoredOrInactive && (existingSessionData.status === 'Aktif' || existingSessionData.status === 'Melanggar')) {
          if (existingSessionData.deviceId && existingSessionData.deviceId !== currentDeviceId) {
            setErrorMessage('Akun Anda sedang digunakan di perangkat/browser lain.');
            setLoading(false);
            setIsLoggingInStudent(false);
            return;
          }
        }
      }

      let currentDeviceId = localStorage.getItem('cbt_device_id');
      if (!currentDeviceId) {
        currentDeviceId = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('cbt_device_id', currentDeviceId);
      }

      // Login to Firebase (Anonymous)
      const uid = await loginAsStudent();
      
      // Time recovery logic for power outage / unexpected crash / browser exit
      let resumeRemainingSecs: number | undefined = undefined;
      let resumeDurationMinutes = matchingExam.duration;

      if (isResume && existingSessionData) {
        // Priority 1: Check saved remainingSeconds from Firestore
        if (typeof existingSessionData.remainingSeconds === 'number' && existingSessionData.remainingSeconds > 0) {
          resumeRemainingSecs = existingSessionData.remainingSeconds;
        } else {
          // Priority 2: Check local backup remaining time
          try {
            const localSaved = localStorage.getItem(`cbt_remaining_time_${targetUid}_${matchingExam.id}`) ||
                               localStorage.getItem(`cbt_remaining_time_${uid}_${matchingExam.id}`);
            if (localSaved) {
              const parsedSecs = parseInt(localSaved, 10);
              if (!isNaN(parsedSecs) && parsedSecs > 0) {
                resumeRemainingSecs = parsedSecs;
              }
            }
          } catch (e) {
            console.error("Gagal membaca local remaining time backup:", e);
          }
        }

        if (resumeRemainingSecs !== undefined && resumeRemainingSecs > 0) {
          resumeDurationMinutes = resumeRemainingSecs / 60;
        } else if (existingSessionData.duration) {
          // Fallback: calculate elapsed time if no remainingSeconds was saved
          const elapsedSecs = Math.floor((Date.now() - existingSessionData.startTime) / 1000);
          const totalSecs = Math.round(existingSessionData.duration * 60);
          resumeRemainingSecs = Math.max(0, totalSecs - elapsedSecs);
          resumeDurationMinutes = resumeRemainingSecs / 60;
        } else {
          resumeRemainingSecs = Math.round(matchingExam.duration * 60);
          resumeDurationMinutes = matchingExam.duration;
        }
      }

      // Determine assigned question package (single or randomized multi-package)
      let assignedPacket = matchingExam.packetName || '';

      if (matchingExam.isRandomPacket && Array.isArray(matchingExam.packetNames) && matchingExam.packetNames.length > 0) {
        const validPackets = matchingExam.packetNames.map(p => p.trim()).filter(Boolean);
        if (validPackets.length > 0) {
          if (matchingExam.packageDistributionMode === 'random') {
            // Pure random assignment
            const randomIndex = Math.floor(Math.random() * validPackets.length);
            assignedPacket = validPackets[randomIndex];
          } else {
            // Balanced Round-Robin distribution across students in this class/exam
            try {
              const qExisting = query(
                collection(db, 'student_sessions'),
                where('examId', '==', matchingExam.id)
              );
              const snapExisting = await getDocs(qExisting);
              
              // Count how many students currently hold each packet
              const counts: Record<string, number> = {};
              validPackets.forEach(p => { counts[p] = 0; });
              
              snapExisting.docs.forEach(docSnap => {
                const sData = docSnap.data();
                if (sData.packetName && counts[sData.packetName] !== undefined) {
                  counts[sData.packetName]++;
                }
              });

              // Select the packet with the lowest current count for perfect balance
              let minCount = Infinity;
              let selectedPkt = validPackets[0];
              for (const p of validPackets) {
                if (counts[p] < minCount) {
                  minCount = counts[p];
                  selectedPkt = p;
                }
              }
              assignedPacket = selectedPkt;
            } catch (err) {
              console.warn("Gagal mengecek kuota paket round-robin, fallback acak:", err);
              const randomIndex = Math.floor(Math.random() * validPackets.length);
              assignedPacket = validPackets[randomIndex];
            }
          }
        }
      }

      const sessionData: StudentSession = isResume ? {
        ...existingSessionData!,
        status: 'Aktif',
        lastActivity: Date.now(),
        startTime: Date.now(), // Reset startTime to NOW so countdown starts smoothly with remaining duration
        duration: resumeDurationMinutes,
        remainingSeconds: resumeRemainingSecs,
        token: examToken, // update token in case it changed
        deviceId: currentDeviceId, // Always bind new deviceId on resume so student can use ANY device
        examTitle: existingSessionData?.examTitle || matchingExam.title,
        packetName: existingSessionData?.packetName || assignedPacket || matchingExam.packetName,
      } : {
        studentName: upperName,
        className: matchingExam.targetClass || 'Tidak Diketahui',
        examId: matchingExam.id!,
        subjectId: matchingExam.subjectId,
        packetName: assignedPacket,
        examTitle: matchingExam.title,
        duration: matchingExam.duration,
        remainingSeconds: Math.round(matchingExam.duration * 60),
        token: examToken,
        status: 'Aktif',
        violationsCount: 0,
        lastActivity: Date.now(),
        startTime: Date.now(),
        adminId: matchingExam.adminId,
        deviceId: currentDeviceId
      };

      // If resuming and the old session was under a different ID, hide old doc from monitor
      if (isResume && targetUid && targetUid !== uid) {
          try {
              // We use updateDoc because students might not have permission to delete
              await updateDoc(doc(db, 'student_sessions', targetUid), {
                  hiddenFromMonitor: true,
                  status: 'Arsip'
              });
          } catch (e) {
              console.warn("Cleanup old session doc failed", e);
          }
      }

      await setDoc(doc(db, 'student_sessions', uid), sessionData);

      sessionStorage.setItem('just_logged_in_student', 'true');
      setIsLoggingInStudent(false);
      setLoading(false);
      navigate('/exam');
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memulai ujian.');
      setIsLoggingInStudent(false);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-50 rounded-full blur-[100px] opacity-50 pointer-events-none -z-0"></div>

      <div className="w-full max-w-md bg-white rounded-[2rem] shadow-xl border border-slate-100 p-8 sm:p-10 relative z-10">
        
        {/* Top Branding Section */}
        <div className="flex flex-col items-center text-center mb-8">
          <motion.div 
            initial={{ scale: 0.45, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ 
              type: "spring", 
              stiffness: 150, 
              damping: 14, 
              delay: 0.1 
            }}
            className="w-24 h-24 bg-white border border-slate-200 shadow-xl rounded-2xl p-1 flex items-center justify-center mb-5 overflow-hidden relative"
          >
            {/* Glow Menyapu (Glow Sweep overlay) */}
            <motion.div
              className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-blue-400/25 via-white/80 via-blue-400/25 to-transparent z-10 pointer-events-none"
              initial={{ left: '-100%', skewX: -20 }}
              animate={{ left: '200%', skewX: -20 }}
              transition={{
                repeat: Infinity,
                repeatType: "loop",
                duration: 2.2,
                ease: "easeInOut",
                repeatDelay: 1.5
              }}
            />
            {/* Continuous subtle inner glow pulse */}
            <motion.div
              className="absolute inset-0 bg-blue-500/5 z-0 pointer-events-none"
              animate={{ opacity: [0.08, 0.28, 0.08] }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            <motion.img 
              src={brandLogo} 
              alt="Exam Pro Plus" 
              className="w-full h-full object-contain relative z-5" 
              referrerPolicy="no-referrer"
              animate={{
                scale: [0.95, 1, 0.95],
                rotate: [0, 0.5, 0, -0.5, 0]
              }}
              transition={{
                scale: {
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut"
                },
                rotate: {
                  duration: 8,
                  repeat: Infinity,
                  ease: "easeInOut"
                }
              }}
            />
          </motion.div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 uppercase">
            Exam Pro Plus
          </h1>
          <p className="text-slate-500 mt-2 text-[11px] px-4 font-bold uppercase tracking-wider opacity-60">
            {setting?.schoolSlogan || 'Professional Digital Assessment System'}
          </p>
        </div>

        {/* Admin Login Box Removed */}

        {errorMessage && (
          <div className="mb-6 p-3.5 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm justify-center flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}
        
        {successMessage && (
          <div className="mb-6 p-3.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl text-sm justify-center flex items-center space-x-2 animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="font-medium">{successMessage}</span>
          </div>
        )}

        <div className="relative">
          <AnimatePresence mode="wait">
            {activeTab === 'student' && (
              <motion.form 
                key="student"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
                onSubmit={handleStudentLogin}
              >
                <div className="mb-2 text-center">
                  <h2 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center justify-center">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse"></span>
                    Portal Login Peserta Ujian
                  </h2>
                </div>

                {linkedExam ? (
                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 mb-4 text-center">
                     <p className="text-[11px] font-bold text-blue-500 uppercase tracking-wider mb-1">Anda diundang ke Ujian</p>
                     <h3 className="text-base font-bold text-slate-800 leading-tight">{linkedExam.title}</h3>
                     <p className="text-sm font-medium text-slate-600 mt-1">{linkedSubjectName} • {linkedExam.targetClass || 'Pendaftar Umum'}</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-center">
                     <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informasi</p>
                     <p className="text-sm font-medium text-slate-600">Masukkan Token Ujian.</p>
                  </div>
                )}                <div className="space-y-4">
                  {/* Token Ujian / Password Input */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Token Ujian</label>
                      {isTokenValidAndActive && (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 flex items-center gap-1 animate-in fade-in">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          Token Terverifikasi
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${isTokenValidAndActive ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <input 
                        type="text" 
                        value={examToken}
                        onChange={(e) => setExamToken(e.target.value.toUpperCase())}
                        placeholder="Masukkan 6 digit token"
                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 border rounded-xl focus:ring-2 outline-none transition-all font-mono uppercase tracking-widest font-bold text-slate-700 text-sm ${
                          isTokenValidAndActive 
                            ? 'border-emerald-300 focus:ring-emerald-500 focus:border-emerald-500 bg-emerald-50/20' 
                            : examToken.length >= 4 
                            ? 'border-amber-300 focus:ring-amber-500 focus:border-amber-500' 
                            : 'border-slate-200 focus:ring-blue-500 focus:border-blue-500 focus:bg-white'
                        }`}
                        maxLength={6}
                      />
                    </div>
                    {/* Token Status Message */}
                    <div className="mt-2 px-0.5 min-h-[22px]">
                      {examToken.trim().length > 0 ? (
                        isTokenValidAndActive ? (
                          <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50/80 border border-emerald-200/80 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 animate-in fade-in">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Ujian Aktif: <strong>{matchingActiveExam?.title}</strong></span>
                          </div>
                        ) : (
                          <div className="text-[11px] font-semibold text-rose-600 bg-rose-50/80 border border-rose-200/80 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 animate-in fade-in">
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                            <span>Token tidak valid atau ujian sedang dinonaktifkan</span>
                          </div>
                        )
                      ) : (
                        <div className="text-[11px] font-medium text-blue-700 bg-blue-50/70 border border-blue-200/60 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                          <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span>Masukkan token ujian aktif untuk memilih nama</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nama Lengkap - Dropdown/Searchable Select */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={`block text-xs font-bold uppercase tracking-wider transition-colors ${!isTokenValidAndActive ? 'text-slate-400' : 'text-slate-700'}`}>
                        Nama Lengkap Anda
                      </label>
                    </div>

                    {availableStudents.length > 0 ? (
                      <div className="relative">
                        <button
                          type="button"
                          disabled={!isTokenValidAndActive}
                          onClick={() => {
                            if (isTokenValidAndActive) setIsDropdownOpen(!isDropdownOpen);
                          }}
                          className={`w-full px-4 py-3.5 border rounded-xl outline-none transition-all text-left text-sm font-bold flex justify-between items-center shadow-xs whitespace-nowrap overflow-hidden text-ellipsis ${
                            !isTokenValidAndActive
                              ? 'bg-slate-100/90 border-slate-200 text-slate-400 cursor-not-allowed select-none opacity-70'
                              : 'bg-slate-50 border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer hover:bg-white'
                          }`}
                        >
                          <span className="truncate">
                            {!isTokenValidAndActive ? (
                              <span className="text-xs font-semibold text-slate-400">MASUKKAN TOKEN AKTIF TERLEBIH DAHULU...</span>
                            ) : studentName ? (
                              studentName
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">CARI & PILIH NAMA ANDA...</span>
                            )}
                          </span>
                          <svg className={`w-4 h-4 ${!isTokenValidAndActive ? 'text-slate-300' : 'text-slate-400'} shrink-0 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        <AnimatePresence>
                          {isDropdownOpen && isTokenValidAndActive && (
                            <motion.div 
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 5 }}
                              className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 flex flex-col gap-2 max-h-60 overflow-hidden"
                            >
                              <div className="relative">
                                <svg className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                <input
                                  type="text"
                                  value={searchDropdownQuery}
                                  onChange={(e) => setSearchDropdownQuery(e.target.value)}
                                  placeholder="MASUKKAN NAMA UNTUK MENCARI..."
                                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none uppercase focus:bg-white text-slate-800"
                                  onClick={(e) => { e.stopPropagation(); }}
                                  autoFocus
                                />
                              </div>
                              
                              <div className="flex-1 overflow-auto divide-y divide-slate-100 max-h-44 pr-1">
                                {(() => {
                                  const filtered = availableStudents.filter(name => name.toLowerCase().includes(searchDropdownQuery.toLowerCase()));
                                  if (filtered.length === 0) {
                                    return (
                                      <div className="p-3 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        Nama tidak ditemukan
                                      </div>
                                    );
                                  }
                                  return filtered.map((name) => (
                                    <button
                                      key={name}
                                      type="button"
                                      onClick={() => {
                                        setStudentName(name);
                                        setIsDropdownOpen(false);
                                        setSearchDropdownQuery('');
                                      }}
                                      className={`w-full px-3 py-2 text-left text-xs font-semibold uppercase text-slate-700 hover:bg-blue-50 hover:text-blue-600 rounded-md transition cursor-pointer flex items-center justify-between ${
                                        studentName === name ? 'bg-blue-50 text-blue-600' : ''
                                      }`}
                                    >
                                      <span>{name}</span>
                                      {studentName === name && (
                                        <svg className="w-3.5 h-3.5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                  ));
                                })()}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <div className="relative">
                        <UserCircle className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 ${!isTokenValidAndActive ? 'text-slate-300' : 'text-slate-400'}`} />
                        <input 
                          type="text" 
                          disabled={!isTokenValidAndActive}
                          readOnly={!isTokenValidAndActive}
                          value={studentName}
                          onChange={(e) => {
                            if (isTokenValidAndActive) setStudentName(e.target.value.toUpperCase());
                          }}
                          placeholder={!isTokenValidAndActive ? "MASUKKAN TOKEN AKTIF TERLEBIH DAHULU..." : "MASUKKAN NAMA LENGKAP ANDA..."}
                          className={`w-full pl-11 pr-4 py-3.5 border rounded-xl outline-none transition-all font-bold text-xs uppercase tracking-wider placeholder:text-slate-400 ${
                            !isTokenValidAndActive
                              ? 'bg-slate-100/90 border-slate-200 text-slate-400 cursor-not-allowed select-none opacity-70'
                              : 'bg-slate-50 border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white'
                          }`}
                        />
                      </div>
                    )}
                  </div>

                  {/* Password / PIN Siswa Input (Conditional on requireStudentPassword) */}
                  {matchingActiveExam?.requireStudentPassword !== false ? (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className={`block text-xs font-bold uppercase tracking-wider transition-colors ${!isTokenValidAndActive || !studentName ? 'text-slate-400' : 'text-slate-700'}`}>
                          Password / PIN Siswa
                        </label>
                      </div>
                      <div className="relative">
                        <KeyRound className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${!isTokenValidAndActive || !studentName ? 'text-slate-300' : 'text-amber-500'}`} />
                        <input 
                          type={showStudentPassword ? "text" : "password"}
                          disabled={!isTokenValidAndActive || !studentName}
                          value={studentPassword}
                          onChange={(e) => setStudentPassword(e.target.value)}
                          placeholder={!isTokenValidAndActive || !studentName ? "PILIH NAMA TERLEBIH DAHULU..." : "MASUKKAN PASSWORD / PIN SISWA..."}
                          className={`w-full pl-11 pr-11 py-3.5 border rounded-xl outline-none transition-all font-mono font-bold text-xs tracking-wider placeholder:font-sans placeholder:tracking-normal ${
                            !isTokenValidAndActive || !studentName
                              ? 'bg-slate-100/90 border-slate-200 text-slate-400 cursor-not-allowed select-none opacity-70'
                              : 'bg-slate-50 border-slate-200 text-slate-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white'
                          }`}
                          maxLength={12}
                        />
                        {isTokenValidAndActive && studentName && (
                          <button
                            type="button"
                            onClick={() => setShowStudentPassword(!showStudentPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                            title={showStudentPassword ? "Sembunyikan PIN" : "Tampilkan PIN"}
                          >
                            {showStudentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                      <p className="text-xs font-extrabold text-emerald-800 uppercase tracking-wide">Password / PIN Dinonaktifkan</p>
                      <p className="text-[10px] text-emerald-600 font-medium mt-0.5">Ujian ini tidak memerlukan password. Anda dapat langsung klik Mulai Ujian.</p>
                    </div>
                  )}
                </div>

                <button 
                  type="submit"
                  disabled={loading || !isTokenValidAndActive || !studentName.trim() || (matchingActiveExam?.requireStudentPassword !== false && !studentPassword.trim())}
                  className="w-full mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      <span>MULAI UJIAN</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            )}
            
            {activeTab === 'admin' && (
              <motion.form 
                key="admin"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleAdminEmailLogin}
                className="space-y-5"
                autoComplete="off"
                data-lpignore="true"
              >
                {/* Honeypot fields to absorb browser autocompletion and cached emails */}
                <input style={{ display: 'none' }} type="email" name="fake_admin_email_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />
                <input style={{ display: 'none' }} type="password" name="fake_admin_password_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />

                <div className="mb-2 text-center">
                  <h2 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center justify-center">
                    <span className="w-1.5 h-1.5 bg-slate-800 rounded-full mr-1.5 animate-pulse"></span>
                    Portal Login Admin / Proktor
                  </h2>
                </div>

                <div>
                  <label htmlFor="admin_email_input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email</label>
                  <input 
                    id="admin_email_input"
                    autoComplete="new-password"
                    data-lpignore="true"
                    type="email" 
                    name="admin_login_user_email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="email@sekolah.com"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label htmlFor="admin_password_input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                         setActiveTab('forgot_password');
                         setErrorMessage('');
                         setSuccessMessage('');
                         setResetEmail(adminEmail);
                      }}
                      className="text-[10px] text-blue-600 font-bold hover:underline"
                    >
                      Lupa password?
                    </button>
                  </div>
                  <input 
                    id="admin_password_input"
                    autoComplete="new-password"
                    data-lpignore="true"
                    type="password" 
                    name="admin_login_user_pass"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 bg-slate-900 hover:bg-slate-800 text-white font-bold tracking-wide py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shadow hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Login sebagai Admin</span>}
                </button>

                <div className="pt-5 border-t border-slate-100 flex justify-center mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('student');
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className="text-[11px] font-extrabold text-slate-400 hover:text-slate-600 hover:underline transition-all uppercase tracking-wider cursor-pointer"
                  >
                    ← Kembali ke Login Siswa
                  </button>
                </div>
              </motion.form>
            )}

            {activeTab === 'forgot_password' && (
              <motion.form 
                key="forgot"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleForgotPassword}
                className="space-y-5"
                autoComplete="off"
                data-lpignore="true"
              >
                {/* Honeypot field for forgot password email */}
                <input style={{ display: 'none' }} type="email" name="fake_forgot_email_field_autofill" tabIndex={-1} aria-hidden="true" value="" readOnly />

                <div className="mb-2 text-center flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mb-3">
                     <KeyRound className="w-6 h-6 text-blue-500" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest">
                    Reset Password
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Masukkan email terdaftar Anda</p>
                </div>

                <div>
                  <label htmlFor="reset_email_input" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Akun</label>
                  <input 
                    id="reset_email_input"
                    autoComplete="new-password"
                    data-lpignore="true"
                    type="email" 
                    name="admin_reset_user_email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="email@sekolah.com"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all focus:bg-white text-sm"
                  />
                </div>
                
                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-wide py-3.5 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50 shadow hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Kirim Tautan Reset</span>}
                </button>

                <div className="pt-5 border-t border-slate-100 flex justify-center mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('admin');
                      setErrorMessage('');
                      setSuccessMessage('');
                    }}
                    className="text-[11px] font-extrabold text-slate-400 hover:text-slate-600 hover:underline transition-all uppercase tracking-wider cursor-pointer"
                  >
                    ← Kembali ke halaman Login
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Floating Key Icon Button in bottom-right corner for Admin / Proktor Login */}
      <button
        type="button"
        onClick={() => {
          setActiveTab(activeTab === 'admin' ? 'student' : 'admin');
          setErrorMessage('');
          setSuccessMessage('');
        }}
        title={activeTab === 'admin' ? 'Kembali ke Portal Siswa' : 'Masuk Portal Admin / Proktor'}
        aria-label="Portal Admin"
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-50 p-2.5 rounded-xl text-slate-300 hover:text-blue-600 hover:bg-white/90 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95 transition-all duration-300 border border-transparent cursor-pointer group"
      >
        <Key className="w-4 h-4 text-slate-300/80 group-hover:text-blue-600 transition-colors duration-300 filter group-hover:drop-shadow-[0_0_6px_rgba(37,99,235,0.7)]" />
      </button>

    </div>
  );
}
