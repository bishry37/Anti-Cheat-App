export interface Setting {
  id?: string;
  schoolName: string;
  schoolLogo?: string;
  schoolAddress?: string;
  schoolSlogan?: string;
  motivationText?: string;
  teacherPhoto?: string;
  maxViolations?: number;
  updatedAt: number;
}

export interface Subject {
  id?: string;
  name: string;
  createdAt: number;
}

export interface Question {
  id?: string;
  subjectId: string;
  number: number;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  optionE: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';
  weight: number;
  packetName?: string;
  createdAt: number;
}

export interface Exam {
  id?: string;
  title: string;
  subjectId: string;
  duration: number; // in minutes
  date: string;
  startTime: string;
  endTime: string;
  questionCount?: number;
  isActive: boolean;
  activeToken: string;
  packetName?: string;
  autoResetInterval: '5' | '10' | '15' | '30' | '60' | 'manual';
  tokenUpdatedAt: number;
  createdAt: number;
}

export interface StudentSession {
  id?: string; // uid
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
  answers?: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>; // questionId -> answer
}

export interface Violation {
  id?: string;
  sessionId: string;
  studentName: string;
  subjectId: string;
  type: string;
  timestamp: number;
  status: string;
}
