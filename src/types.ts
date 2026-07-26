export interface Setting {
  id?: string;
  adminId?: string;
  schoolName: string;
  schoolLogo?: string;
  schoolAddress?: string;
  schoolSlogan?: string;
  motivationText?: string;
  teacherPhoto?: string;
  teacherName?: string;
  teacherRole?: string;
  maxViolations?: number;
  updatedAt: number;
}

export interface Subject {
  id?: string;
  adminId?: string;
  name: string;
  createdAt: number;
}

export interface Class {
  id?: string;
  adminId?: string;
  name: string;
  students?: string[];
  createdAt: number;
}

export interface AudioItem {
  id?: string;
  adminId?: string;
  name: string;
  description?: string;
  fileName: string;
  audioData: string;
  duration: number; // in seconds
  allowRepeat: 'Ya' | 'Tidak';
  createdAt: number;
  isChunked?: boolean;
}

export interface Question {
  id?: string;
  adminId?: string;
  subjectId: string;
  number: number;
  question: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  optionE?: string;
  correctAnswer: string;
  weight: number;
  packetName?: string;
  type?: 'pilihan_ganda' | 'isian_singkat' | 'essay' | 'listening';
  typeCode?: number;
  createdAt: number;
}

export interface Exam {
  id?: string;
  adminId?: string;
  title: string;
  subjectId: string;
  audioId?: string;
  duration: number; // in minutes
  date?: string;
  startTime?: string;
  endTime?: string;
  questionCount?: number;
  isActive: boolean;
  activeToken: string;
  packetName?: string;
  autoResetInterval: '5' | '10' | '15' | '30' | '60' | 'manual';
  tokenUpdatedAt: number;
  createdAt: number;
  targetClass?: string;
  shortCode?: string;
  randomizeQuestions?: boolean;
  showScoreToStudent?: boolean;
  maxViolations?: number;
}

export interface StudentSession {
  id?: string; // uid
  adminId?: string;
  studentName: string;
  className: string;
  examId: string;
  subjectId: string;
  packetName?: string;
  token: string;
  status: 'Aktif' | 'Tidak Fokus' | 'Melanggar' | 'Selesai' | 'Didiskualifikasi';
  violationsCount: number;
  lastActivity: number;
  startTime: number;
  endTime?: number;
  score?: number;
  correctCount?: number;
  wrongCount?: number;
  answers?: Record<string, string>; // questionId -> answer
  essayScores?: Record<string, number>; // questionId -> custom grade
  adminWarningMessage?: string;
  adminWarningTime?: number;
  lastQuestionIndex?: number;
  wasDisqualified?: boolean;
  duration?: number;
  deviceId?: string;
  adjustedRemainingMinutes?: number;
  adjustedAt?: number;
  questionOrder?: string[];
  optionsOrder?: Record<string, string[]>;
  hiddenFromMonitor?: boolean;
}

export interface Violation {
  id?: string;
  adminId?: string;
  sessionId: string;
  studentName: string;
  subjectId: string;
  type: string;
  timestamp: number;
  status: string;
}

