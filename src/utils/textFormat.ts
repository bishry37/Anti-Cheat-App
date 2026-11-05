import { wrapBareLaTeX, renderMathInString } from './mathRenderer';

export const formatHTML = (text: string | undefined | null): string => {
  if (!text) return '';
  const rawStr = String(text);
  
  let formattedHtml: string;
  // If the text appears to already contain HTML formatting (e.g. from Quill)
  if (/<[a-z][\s\S]*>/i.test(rawStr)) {
    formattedHtml = rawStr;
  } else {
    // For plain text (like from Excel or plain text input), split by newlines and wrap in <p> tags
    const lines = rawStr.split(/\r?\n/);
    formattedHtml = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed) {
         return `<p>${trimmed}</p>`;
      } else {
         return '<br/>';
      }
    }).join('');
  }

  return renderMathInString(formattedHtml);
};

export const normalizeTextForGrading = (text: string | null | undefined): string => {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    // Replace punctuation with spaces: . , / # ! $ % ^ & * ; : { } = - \ _ ` ~ ( ) ? " ' [ ]
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'\[\]]/g, ' ')
    // Collapse excess whitespaces
    .replace(/\s+/g, ' ')
    .trim();
};

export const calculateSmartPoints = (
  studentAns: string | null | undefined, 
  correctAns: string | null | undefined, 
  weight: number
): number => {
  const sAns = studentAns || '';
  const cAns = correctAns || '';
  if (!sAns.trim()) return 0;

  const s = normalizeTextForGrading(sAns);
  const c = normalizeTextForGrading(cAns);

  // If they are identical under normalization, give full points
  if (s === c) return weight;
  if (!s) return 0;

  // Otherwise, word-level overlap smart matching
  const sWords = s.split(' ');
  const cWords = c.split(' ');
  const maxLen = Math.max(sWords.length, cWords.length);

  let matches = 0;
  const tempCWords = [...cWords];
  sWords.forEach(w => {
    // optional: ignore very common English helper words
    if (['a', 'an', 'the'].includes(w)) return;
    
    const idx = tempCWords.indexOf(w);
    if (idx !== -1) {
      matches++;
      tempCWords.splice(idx, 1);
    }
  });

  const missingOrWrongCount = maxLen - matches;

  if (missingOrWrongCount === 1) return weight * 0.9;
  if (missingOrWrongCount > 1 && matches >= maxLen / 2) return weight * 0.5;

  return 0;
};

export const isOptionEmpty = (val: string | undefined | null): boolean => {
  if (!val) return true;
  const s = String(val).trim();
  return !s || s === '<p><br></p>' || s === '<p></p>' || s === '<br>' || s === '<p><br/></p>';
};

export interface PgkGradingResult {
  earned: number;
  isFull: boolean;
  isPartial: boolean;
  isWrong: boolean;
  correctChosenCount: number;
  totalCorrectCount: number;
}

export const calculatePgkPoints = (
  studentAns: string | null | undefined, 
  correctAns: string | null | undefined, 
  weight: number,
  totalAvailableOptions: number = 5
): PgkGradingResult => {
  const correctKeys = (correctAns || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);
  const studentKeys = (studentAns || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (studentKeys.length === 0 || correctKeys.length === 0) {
    return { earned: 0, isFull: false, isPartial: false, isWrong: true, correctChosenCount: 0, totalCorrectCount: correctKeys.length };
  }

  // Jika siswa klik SEMUA pilihan jawaban padahal kunci jawaban tidak semuanya (misal kunci hanya 3 dari 5), maka nilai 0
  if (studentKeys.length >= totalAvailableOptions && correctKeys.length < totalAvailableOptions) {
    return { earned: 0, isFull: false, isPartial: false, isWrong: true, correctChosenCount: 0, totalCorrectCount: correctKeys.length };
  }

  const correctChosen = studentKeys.filter(k => correctKeys.includes(k));
  const wrongChosen = studentKeys.filter(k => !correctKeys.includes(k));

  if (correctChosen.length === 0) {
    return { earned: 0, isFull: false, isPartial: false, isWrong: true, correctChosenCount: 0, totalCorrectCount: correctKeys.length };
  }

  // Jika semua kunci jawaban benar terpilih dan tidak ada opsi salah yang dipilih -> Benar Sempurna (100% poin)
  if (correctChosen.length === correctKeys.length && wrongChosen.length === 0) {
    return { earned: weight, isFull: true, isPartial: false, isWrong: false, correctChosenCount: correctChosen.length, totalCorrectCount: correctKeys.length };
  }

  // Berikan poin sesuai proporsi jawaban benar siswa
  const correctRatio = correctChosen.length / correctKeys.length;
  let finalRatio = correctRatio;

  // Jika ada opsi salah yang turut dipilih, jangan pernah berikan poin full
  if (wrongChosen.length > 0) {
    const maxPartialRatio = Math.max(0, (correctKeys.length - 1) / correctKeys.length);
    finalRatio = Math.min(correctRatio, maxPartialRatio);
  }

  const earned = Math.max(0, Number((finalRatio * weight).toFixed(2)));

  return {
    earned,
    isFull: false,
    isPartial: earned > 0,
    isWrong: earned === 0,
    correctChosenCount: correctChosen.length,
    totalCorrectCount: correctKeys.length
  };
};
