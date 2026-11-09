import { StudentRecord } from '../types';

/**
 * Normalizes a student item (string or StudentRecord) to retrieve the uppercase name.
 */
export const getStudentName = (item: string | StudentRecord | undefined | null): string => {
  if (!item) return '';
  if (typeof item === 'string') return item.trim().toUpperCase();
  return (item.name || '').trim().toUpperCase();
};

export const DEFAULT_STUDENT_PIN = '12345';

/**
 * Retrieves the PIN/Password for a student record. Defaults to '12345' if unassigned.
 */
export const getStudentPin = (item: string | StudentRecord | undefined | null): string => {
  if (!item) return DEFAULT_STUDENT_PIN;
  if (typeof item === 'string') return DEFAULT_STUDENT_PIN;
  return (item.pin || DEFAULT_STUDENT_PIN).trim();
};

/**
 * Extracts a Google Drive file ID from various link and share formats:
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID
 * - https://drive.google.com/uc?export=view&id=FILE_ID
 * - https://drive.google.com/thumbnail?id=FILE_ID
 * - https://docs.google.com/file/d/FILE_ID/...
 * - Direct ID strings
 */
export const extractGoogleDriveFileId = (input: string): string | null => {
  if (!input) return null;
  const str = input.trim();
  
  // Format: /file/d/{id} or /d/{id}
  const matchFileD = str.match(/(?:\/file\/d\/|\/d\/)([a-zA-Z0-9_-]{20,})/);
  if (matchFileD && matchFileD[1]) return matchFileD[1];

  // Format: id={id}
  const matchIdParam = str.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (matchIdParam && matchIdParam[1]) return matchIdParam[1];

  // Check if raw string is an alphanumeric Drive file ID (usually 25-50 chars)
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(str)) {
    return str;
  }

  return null;
};

/**
 * Formats a raw photo string (URL, Google Drive, Dropbox, base64 data URL) into a direct, browser-displayable URL.
 */
export const formatPhotoUrl = (rawUrl: string | undefined | null): string | undefined => {
  if (!rawUrl) return undefined;
  let url = rawUrl.trim();
  // Strip enclosing quotes or angle brackets if pasted by accident
  url = url.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '').trim();
  if (!url) return undefined;

  // Base64 data URLs or object blob URLs
  if (url.startsWith('data:image/') || url.startsWith('blob:')) {
    return url;
  }

  // Google Drive URLs: convert to direct high-performance Google CDN
  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${driveId}`;
  }

  // Dropbox links: convert ?dl=0 to ?raw=1
  if (url.includes('dropbox.com')) {
    return url.replace('?dl=0', '?raw=1').replace('&dl=0', '&raw=1');
  }

  return url;
};

/**
 * Returns an alternative fallback URL if primary Google Drive URL fails to load or faces CDN limits.
 */
export const getFallbackPhotoUrl = (rawUrl: string | undefined | null): string | undefined => {
  if (!rawUrl) return undefined;
  const driveId = extractGoogleDriveFileId(rawUrl);
  if (driveId) {
    // Google Drive Thumbnail API works very reliably for publicly shared items
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w600`;
  }
  return undefined;
};

/**
 * Retrieves the normalized photo URL for a student record.
 * Returns undefined if no photo is configured (making photos completely optional).
 */
export const getStudentPhoto = (item: string | StudentRecord | undefined | null): string | undefined => {
  if (!item) return undefined;
  if (typeof item === 'string') {
    if (item.startsWith('http') || item.startsWith('data:image/')) {
      return formatPhotoUrl(item);
    }
    return undefined;
  }
  return formatPhotoUrl(item.photo);
};

/**
 * Compresses an uploaded image file into a compact 2x3 portrait JPEG base64 data URL.
 * Automatically center-crops to 2:3 ratio (240x360 px), producing a lightweight (~15-25 KB)
 * image that stores reliably in Firestore and works 100% offline without permission issues.
 */
export const compressStudentPhoto = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File yang dipilih bukan file gambar (JPG, PNG, WebP).'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const targetWidth = 240;
          const targetHeight = 360; // 2:3 ratio
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas tidak dapat diakses'));
            return;
          }

          // Center crop cover
          const srcRatio = img.width / img.height;
          const targetRatio = targetWidth / targetHeight;
          let renderW = targetWidth;
          let renderH = targetHeight;
          let offsetX = 0;
          let offsetY = 0;

          if (srcRatio > targetRatio) {
            // Source is wider than target -> fit height, crop width
            renderH = targetHeight;
            renderW = img.width * (targetHeight / img.height);
            offsetX = (targetWidth - renderW) / 2;
          } else {
            // Source is taller than target -> fit width, crop height
            renderW = targetWidth;
            renderH = img.height * (targetWidth / img.width);
            offsetY = (targetHeight - renderH) / 2;
          }

          // Fill clean background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetWidth, targetHeight);

          // Draw centered image
          ctx.drawImage(img, offsetX, offsetY, renderW, renderH);

          // Export as compressed JPEG
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Gagal membaca gambar.'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
};

/**
 * Generates a random 5-digit numeric PIN.
 */
export const generateRandomPin = (): string => {
  return Math.floor(10000 + Math.random() * 90000).toString();
};

/**
 * Generates a default PIN (random 5-digit PIN).
 */
export const generateDefaultPin = (): string => {
  return generateRandomPin();
};

/**
 * Converts a raw string or object into a standardized StudentRecord.
 */
export const normalizeStudentRecord = (item: string | StudentRecord): StudentRecord => {
  if (typeof item === 'string') {
    const trimmed = item.trim().toUpperCase();
    return { name: trimmed, pin: generateRandomPin() };
  }
  const rec: StudentRecord = {
    name: (item.name || '').trim().toUpperCase(),
    pin: (item.pin || generateRandomPin()).trim()
  };
  if (item.nisn && item.nisn.trim()) rec.nisn = item.nisn.trim();
  if (item.photo && item.photo.trim()) rec.photo = item.photo.trim();
  return rec;
};

/**
 * Parses raw input text (e.g. from bulk input) into a StudentRecord.
 * Format examples:
 * "BUDI SETIAWAN" -> name: BUDI SETIAWAN, pin: random 5-digit PIN
 * "BUDI SETIAWAN, 48123" -> name: BUDI SETIAWAN, pin: 48123
 * "BUDI SETIAWAN, 48123, https://..." -> name: BUDI SETIAWAN, pin: 48123, photo: url
 */
export const parseStudentInput = (raw: string): StudentRecord => {
  const parts = raw.split(',').map(p => p.trim());
  if (parts.length >= 3 && parts[1]) {
    const rec: StudentRecord = {
      name: parts[0].toUpperCase(),
      pin: parts[1] || generateRandomPin()
    };
    if (parts[2]) rec.photo = parts[2];
    return rec;
  }
  if (parts.length >= 2 && parts[1]) {
    return {
      name: parts[0].toUpperCase(),
      pin: parts[1] || generateRandomPin()
    };
  }
  return {
    name: raw.toUpperCase(),
    pin: generateRandomPin()
  };
};
