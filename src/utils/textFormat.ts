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

export const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) row[i] = i;

  for (let j = 1; j <= b.length; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = row[i];
      if (a[i - 1] === b[j - 1]) {
        row[i] = prev;
      } else {
        row[i] = Math.min(prev + 1, row[i] + 1, row[i - 1] + 1);
      }
      prev = temp;
    }
  }
  return row[a.length];
};

export const lightStem = (word: string): string => {
  let w = word.toLowerCase();
  w = w.replace(/(nya|lah|kah|pun|tah|ku|mu)$/i, '');
  w = w.replace(/(kan|an|i)$/i, '');
  w = w.replace(/^(meng|men|mem|me|peng|pen|pem|pe|ber|ter|di|ke|se)/i, '');
  w = w.replace(/(ing|ed|s|es)$/i, '');
  return w;
};

// Kamus singkatan, akronim, dan padanan kata lintas mata pelajaran
const ABBREVIATIONS_MAP: Record<string, string> = {
  // Grammar & Bahasa Inggris
  's': 'subject',
  'sub': 'subject',
  'subj': 'subject',
  'subjek': 'subject',
  'subject': 'subject',

  'v': 'verb',
  'vb': 'verb',
  'verb': 'verb',
  'verba': 'verb',
  'katakerja': 'verb',

  'o': 'object',
  'obj': 'object',
  'objek': 'object',
  'object': 'object',

  'c': 'complement',
  'comp': 'complement',
  'pelengkap': 'complement',

  'adv': 'adverb',
  'keterangan': 'adverb',
  'adj': 'adjective',
  'noun': 'noun',

  // Bahasa Indonesia & Kata Tugas / Singkatan Umum
  'dgn': 'dengan',
  'dg': 'dengan',
  'yg': 'yang',
  'utk': 'untuk',
  'kpd': 'kepada',
  'dlm': 'dalam',
  'dr': 'dari',
  'sdh': 'sudah',
  'udh': 'sudah',
  'blm': 'belum',
  'bkn': 'bukan',
  'krn': 'karena',
  'karna': 'karena',
  'tdk': 'tidak',
  'tak': 'tidak',
  'gak': 'tidak',
  'nggak': 'tidak',
  'thd': 'terhadap',
  'tsb': 'tersebut',
  'sbg': 'sebagai',
  'sy': 'saya',
  'km': 'kamu',
  'kmu': 'kamu',
  'mrk': 'mereka',
  'dll': 'dan lain lain',
  'dsb': 'dan sebagainya',
  'dkk': 'dan kawan kawan',
  'tgl': 'tanggal',
  'thn': 'tahun',
  'th': 'tahun',
  'bln': 'bulan',
  'hr': 'hari',
  'cth': 'contoh',
  'mis': 'contoh',
  'misal': 'contoh',
  'misalkan': 'contoh',
  'contohnya': 'contoh',

  // Sinonim & Parafrase Kata Penghubung
  'merupakan': 'adalah',
  'ialah': 'adalah',
  'yaitu': 'adalah',
  'yakni': 'adalah',
  'berarti': 'adalah',

  'bisa': 'dapat',
  'mampu': 'dapat',
  'sanggup': 'dapat',
  'punya': 'memiliki',
  'mempunyai': 'memiliki',
  'kaitan': 'hubungan',
  'interaksi': 'hubungan',
  'relasi': 'hubungan',
  'studi': 'ilmu',
  'kajian': 'ilmu',
  'lautan': 'laut',
  'perairan': 'laut',
  'bahari': 'laut',
  'tanaman': 'tumbuhan',
  'bantuan': 'menggunakan',
  'sinar': 'cahaya',
  'membuat': 'menghasilkan',
  'menciptakan': 'menghasilkan'
};

export const cleanAndTokenizeForSmartGrading = (text: string | null | undefined): string[] => {
  if (!text) return [];
  let str = String(text).toLowerCase();

  // Bersihkan format HTML jika ada
  str = str.replace(/<[^>]*>/g, ' ');

  // Normalisasi parafrase frasa multi-kata
  str = str.replace(/\bmakhluk\s+hidup\b/g, 'organisme');
  str = str.replace(/\bpast\s+participle\b/g, 'verb 3');
  str = str.replace(/\bpast\s+tense\b/g, 'verb 2');
  str = str.replace(/\bsimple\s+present\b/g, 'verb 1');
  str = str.replace(/\bkata\s+kerja\b/g, 'verb');
  str = str.replace(/\bkata\s+benda\b/g, 'noun');
  str = str.replace(/\bkata\s+sifat\b/g, 'adjective');
  str = str.replace(/\bkata\s+keterangan\b/g, 'adverb');
  str = str.replace(/\bsinar\s+matahari\b/g, 'cahaya matahari');
  str = str.replace(/\bkarbon\s+dioksida\b/g, 'co2');
  str = str.replace(/\bkarbondioksida\b/g, 'co2');

  // Pisahkan digit dan huruf pada formula (misal: v3 -> v 3, v-3 -> v 3, v2 -> v 2)
  str = str.replace(/([a-zA-Z])([0-9]+)/g, '$1 $2');
  str = str.replace(/([0-9]+)([a-zA-Z])/g, '$1 $2');
  str = str.replace(/([a-zA-Z])-([0-9]+)/g, '$1 $2');

  // Format simbol rumus matematika / tata bahasa (+, =, /) dengan spasi
  str = str.replace(/\s*\+\s*/g, ' + ');
  str = str.replace(/\s*=\s*/g, ' = ');
  str = str.replace(/\s*\/\s*/g, ' / ');

  const rawWords = str.split(/[\s,.;:!?()\"'\[\]{}]+/);
  const result: string[] = [];

  rawWords.forEach(w => {
    const clean = w.trim();
    if (!clean) return;
    const mapped = ABBREVIATIONS_MAP[clean] || clean;
    mapped.split(/\s+/).forEach(part => {
      if (part) result.push(part);
    });
  });

  return result;
};

export const isTokenMatch = (sToken: string, cToken: string): boolean => {
  if (sToken === cToken) return true;

  // Stemming match (toleransi imbuhan Bahasa Indonesia dan Bahasa Inggris)
  const stemS = lightStem(sToken);
  const stemC = lightStem(cToken);
  if (stemS.length >= 3 && stemS === stemC) return true;

  // Typo tolerance menggunakan Levenshtein Distance
  const maxLen = Math.max(sToken.length, cToken.length);
  if (maxLen >= 4) {
    const dist = levenshteinDistance(sToken, cToken);
    // Beda 1 huruf typo (misal: "presidn" vs "presiden", "subjet" vs "subject")
    if (dist <= 1 || (1 - dist / maxLen >= 0.75)) return true;
  }

  return false;
};

export const normalizeTextForGrading = (text: string | null | undefined): string => {
  return cleanAndTokenizeForSmartGrading(text).join(' ');
};

export const calculateSmartPoints = (
  studentAns: string | null | undefined, 
  correctAns: string | null | undefined, 
  weight: number
): number => {
  const sAns = (studentAns || '').trim();
  const cAns = (correctAns || '').trim();
  if (!sAns || !cAns) return 0;

  const filler = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'pada', 'untuk', 'dengan', 'adalah', 'ini', 'itu', 
    'atau', 'the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'with', 'is', 'are', 'was', 'were', '/'
  ]);

  const sRawTokens = cleanAndTokenizeForSmartGrading(sAns);
  const sSignificantTokens = sRawTokens.filter(t => !filler.has(t));
  const sTokens = sSignificantTokens.length > 0 ? sSignificantTokens : sRawTokens;
  if (sTokens.length === 0) return 0;

  // Split correctAnswer by '/' or 'OR' or ';' or '\n' or 'atau' or 'and/or'
  const rawAlternatives = cAns.split(/\/|\\|;|\n|\bOR\b|\batau\b|\band\/or\b/gi);
  const acceptablePhrases: string[][] = [];

  rawAlternatives.forEach(alt => {
    const trimmedAlt = alt.trim();
    if (!trimmedAlt) return;

    // Extract parts outside parentheses and inside parentheses
    const parts: string[] = [trimmedAlt];

    // Extract all parenthesized content e.g. "(FOMO)", "(OR FILTER BUBBLES)"
    const parenMatches = trimmedAlt.match(/\(([^)]+)\)/g);
    if (parenMatches) {
      parenMatches.forEach(p => {
        let inner = p.replace(/[()]/g, '').trim();
        inner = inner.replace(/^(OR|atau|AND|dan)\s+/i, '').trim();
        if (inner) parts.push(inner);
      });
      const withoutParen = trimmedAlt.replace(/\([^)]+\)/g, '').trim();
      if (withoutParen) parts.push(withoutParen);
    }

    parts.forEach(part => {
      let cleanPart = part.replace(/^(OR|atau|AND|dan)\s+/i, '').trim();
      const rawToks = cleanAndTokenizeForSmartGrading(cleanPart);
      const sigToks = rawToks.filter(t => !filler.has(t));
      const finalToks = sigToks.length > 0 ? sigToks : rawToks;
      if (finalToks.length > 0) {
        acceptablePhrases.push(finalToks);
      }
    });
  });

  let maxCoverage = 0;

  for (const cTokens of acceptablePhrases) {
    if (cTokens.length === 0) continue;

    // Stemmed joined string comparison
    const sStemNorm = sTokens.map(lightStem).join(' ');
    const cStemNorm = cTokens.map(lightStem).join(' ');
    if (sStemNorm === cStemNorm) return weight;

    let matchCount = 0;
    cTokens.forEach(cTok => {
      if (sTokens.some(sTok => isTokenMatch(sTok, cTok))) {
        matchCount++;
      }
    });

    const coverage = matchCount / Math.max(cTokens.length, sTokens.length);
    if (coverage > maxCoverage) {
      maxCoverage = coverage;
    }

    // Full points criteria:
    // 1. All significant tokens of candidate phrase are matched by student (e.g., student wrote "the fear of missing out" vs "fear of missing out" -> matched 3/3)
    // 2. Student provided a single word/acronym (e.g. "FOMO") that is contained in cTokens or is equal to cTokens
    // 3. Match count is at least 75% of candidate phrase tokens
    if (
      matchCount === cTokens.length ||
      (sTokens.length === cTokens.length && matchCount >= cTokens.length * 0.75) ||
      (sTokens.length === 1 && cTokens.some(cTok => isTokenMatch(sTokens[0], cTok)))
    ) {
      return weight;
    }
  }

  if (maxCoverage >= 0.7) return weight;
  if (maxCoverage >= 0.5) return Number((weight * 0.9).toFixed(1));
  if (maxCoverage >= 0.35) return Number((weight * 0.75).toFixed(1));
  if (maxCoverage >= 0.2) return Number((weight * 0.5).toFixed(1));
  if (maxCoverage >= 0.1) return Number((weight * 0.25).toFixed(1));

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
