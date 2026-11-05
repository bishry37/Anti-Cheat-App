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
    nisn: item.nisn ? item.nisn.trim() : undefined
  };
};

/**
 * Parses raw input text (e.g. from single or bulk input) into a StudentRecord.
 * Format examples:
 * "BUDI SETIAWAN" -> name: BUDI SETIAWAN, pin: random
 * "BUDI SETIAWAN, 4812" -> name: BUDI SETIAWAN, pin: 4812
 */
export const parseStudentInput = (raw: string): StudentRecord => {
  const parts = raw.split(',').map(p => p.trim());
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
