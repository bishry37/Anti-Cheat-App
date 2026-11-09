import { StudentSession, Question } from '../types';
import { calculateSmartPoints, calculatePgkPoints } from './textFormat';

const isOptionEmpty = (val: string | number | undefined | null): boolean => {
  if (val === undefined || val === null) return true;
  const str = String(val).trim();
  if (/<(img|audio|video|iframe|svg|math)/i.test(str)) {
    return false;
  }
  const plainText = str.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
  return plainText === '';
};

/**
 * Calculates score, correct count, and wrong count for a student's answers based on exam questions.
 */
export function calculateSessionScore(answers: Record<string, string> = {}, questions: Question[] = []): {
  score: number;
  pointsEarned: number;
  totalWeight: number;
  correctCount: number;
  wrongCount: number;
} {
  let pointsEarned = 0;
  let totalWeight = 0;
  let correct = 0;
  let wrong = 0;

  questions.forEach(q => {
    const weight = typeof q.weight === 'number' && q.weight > 0 ? q.weight : 10;
    totalWeight += weight;

    const studentAns = answers ? answers[q.id!] : undefined;

    if (q.type === 'pilihan_ganda' || q.type === 'listening') {
      if (studentAns && studentAns === q.correctAnswer) {
        correct++;
        pointsEarned += weight;
      } else {
        wrong++;
      }
    } else if (q.type === 'pilihan_ganda_kompleks') {
      const totalOptions = ((q as any).shuffledOptions?.length) || (['A', 'B', 'C', 'D', 'E'].filter(l => !isOptionEmpty(q[`option${l}` as keyof Question])).length) || 5;
      const pgk = calculatePgkPoints(studentAns, q.correctAnswer, weight, totalOptions);
      pointsEarned += pgk.earned;
      if (pgk.isFull || pgk.isPartial) {
        correct++;
      } else {
        wrong++;
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

  const rawScore = totalWeight > 0 ? (pointsEarned / totalWeight) * 100 : 0;
  const score = Number(rawScore.toFixed(2));

  return {
    score,
    pointsEarned,
    totalWeight,
    correctCount: correct,
    wrongCount: wrong
  };
}

/**
 * Deduplicates student sessions so that each unique student (identified by studentName and examId)
 * appears at most once. Gives priority to completed ('Selesai') sessions over active, focus lost, or disqualified ones.
 */
export function deduplicateStudentSessions(data: StudentSession[]): StudentSession[] {
  const map = new Map<string, StudentSession>();

  data.forEach(s => {
    const cleanName = (s.studentName || '').trim().toUpperCase();
    if (!cleanName || !s.examId) return;
    const key = `${cleanName}_${s.examId}`;

    if (!map.has(key)) {
      map.set(key, s);
    } else {
      const existing = map.get(key)!;

      const getPriority = (status: string) => {
        if (status === 'Selesai') return 5;
        if (status === 'Aktif') return 4;
        if (status === 'Tidak Fokus') return 3;
        if (status === 'Melanggar') return 2;
        if (status === 'Didiskualifikasi') return 1;
        return 0;
      };

      const pNew = getPriority(s.status);
      const pOld = getPriority(existing.status);

      if (pNew > pOld) {
        map.set(key, s);
      } else if (pNew === pOld) {
        const timeNew = s.endTime || s.lastActivity || s.startTime || 0;
        const timeOld = existing.endTime || existing.lastActivity || existing.startTime || 0;
        if (timeNew > timeOld) {
          map.set(key, s);
        }
      }
    }
  });

  return Array.from(map.values());
}

