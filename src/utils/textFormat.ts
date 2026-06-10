export const formatHTML = (text: string | undefined | null): string => {
  if (!text) return '';
  const str = String(text);
  
  // If the text appears to already contain HTML formatting (e.g. from Quill)
  if (/<[a-z][\s\S]*>/i.test(str)) {
    return str;
  }
  
  // For plain text (like from Excel), split by newlines and wrap in <p> tags
  // to ensure proper vertical spacing (margin-bottom) via CSS.
  const lines = str.split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed) {
       return `<p>${trimmed}</p>`;
    } else {
       return '<br/>';
    }
  }).join('');
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
