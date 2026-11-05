import { StudentRecord } from '../types';

/**
 * Normalizes a student item (string or StudentRecord) to retrieve the uppercase name.
 */
export const getStudentName = (item: string | StudentRecord | undefined | null): string => {
  if (!item) return '';
  if (typeof item === 'string') return item.trim().toUpperCase();
  return (item.name || '').trim().toUpperCase();
};

/**
 * Retrieves the PIN/Password for a student record. Defaults to '1234' if unassigned.
 */
export const getStudentPin = (item: string | StudentRecord | undefined | null): string => {
  if (!item) return '1234';
  if (typeof item === 'string') return '1234';
  return (item.pin || '1234').trim();
};

/**
 * Retrieves the photo URL/base64 for a student record and converts Google Drive share links to direct viewable format.
 */
export const getStudentPhoto = (item: string | StudentRecord | undefined | null): string | undefined => {
  if (!item || typeof item === 'string') return undefined;
  let url = (item.photo || '').trim();
  if (!url) return undefined;

  // Convert Google Drive share links to direct image embed links if applicable
  // e.g. https://drive.google.com/file/d/FILE_ID/view?usp=sharing -> https://lh3.googleusercontent.com/d/FILE_ID
  // or https://drive.google.com/open?id=FILE_ID -> https://lh3.googleusercontent.com/d/FILE_ID
  try {
    if (url.includes('drive.google.com')) {
      let fileId = '';
      if (url.includes('/file/d/')) {
        const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) fileId = match[1];
      } else if (url.includes('id=')) {
        const urlParams = new URL(url).searchParams;
        fileId = urlParams.get('id') || '';
      }
      if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
      }
    }
  } catch (e) {
    console.warn("Failed to parse Google Drive URL:", e);
  }

  return url;
};

/**
 * Generates a random 4-digit numeric PIN.
 */
export const generateDefaultPin = (): string => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Converts a raw string or object into a standardized StudentRecord.
 */
export const normalizeStudentRecord = (item: string | StudentRecord): StudentRecord => {
  if (typeof item === 'string') {
    const trimmed = item.trim().toUpperCase();
    return { name: trimmed, pin: generateDefaultPin() };
  }
  return {
    name: (item.name || '').trim().toUpperCase(),
    pin: (item.pin || generateDefaultPin()).trim(),
    nisn: item.nisn ? item.nisn.trim() : undefined,
    photo: item.photo ? item.photo.trim() : undefined
  };
};

/**
 * Parses raw input text (e.g. from single or bulk input) into a StudentRecord.
 * Format examples:
 * "BUDI SETIAWAN" -> name: BUDI SETIAWAN, pin: random
 * "BUDI SETIAWAN, 4812" -> name: BUDI SETIAWAN, pin: 4812
 * "BUDI SETIAWAN, 4812, https://..." -> name: BUDI SETIAWAN, pin: 4812, photo: url
 */
export const parseStudentInput = (raw: string): StudentRecord => {
  const parts = raw.split(',').map(p => p.trim());
  if (parts.length >= 3 && parts[1]) {
    return {
      name: parts[0].toUpperCase(),
      pin: parts[1],
      photo: parts[2]
    };
  }
  if (parts.length >= 2 && parts[1]) {
    return {
      name: parts[0].toUpperCase(),
      pin: parts[1]
    };
  }
  return {
    name: raw.toUpperCase(),
    pin: generateDefaultPin()
  };
};
