import { StudentSession } from '../types';

/**
 * Deduplicates student sessions so that each unique student (identified by studentName and examId)
 * appears at most once. Gives priority to completed ('Selesai') sessions over active or disqualified ones.
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
        if (status === 'Selesai') return 4;
        if (status === 'Aktif') return 3;
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
