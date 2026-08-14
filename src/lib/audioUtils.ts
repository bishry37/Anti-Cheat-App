/**
 * Utility functions for handling audio URLs, Google Drive stream URLs,
 * and base64 audio data.
 */

export const extractGoogleDriveFileId = (inputUrl?: string): string | null => {
  if (!inputUrl) return null;
  const trimmed = inputUrl.trim();

  // Handle URL decoded if it was wrapped in /api/audio-proxy?url=... or ?id=...
  if (trimmed.includes('/api/audio-proxy')) {
    const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) return idMatch[1];
    const urlMatch = trimmed.match(/[?&]url=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
      try {
        const decoded = decodeURIComponent(urlMatch[1]);
        const innerId = extractGoogleDriveFileId(decoded);
        if (innerId) return innerId;
      } catch (e) {
        // Continue
      }
    }
  }

  // 1. Standard file path format: /file/d/FILE_ID or /d/FILE_ID
  const matchFileD = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/);
  if (matchFileD && matchFileD[1]) return matchFileD[1];

  // 2. Query param format: id=FILE_ID or docid=FILE_ID
  const matchIdParam = trimmed.match(/[?&](?:id|docid)=([a-zA-Z0-9_-]+)/);
  if (matchIdParam && matchIdParam[1]) return matchIdParam[1];

  // 3. googleusercontent format: googleusercontent.com/d/FILE_ID
  const matchLh3 = trimmed.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (matchLh3 && matchLh3[1]) return matchLh3[1];

  // 4. Standalone file ID (at least 20 chars of alphanumeric/hyphen/underscore)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !trimmed.startsWith('http') && !trimmed.startsWith('data:') && !trimmed.startsWith('/')) {
    return trimmed;
  }

  return null;
};

/**
 * Returns prioritized playable audio source URLs.
 * Resolves Google Drive, external audio URLs, and base64 strings.
 */
export const getAudioSourceUrls = (raw?: string): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();

  // Check if it's a Google Drive link or file ID
  const fileId = extractGoogleDriveFileId(trimmed);
  if (fileId) {
    return [
      `/api/audio-proxy?id=${fileId}`,
      `https://drive.google.com/uc?export=download&id=${fileId}`,
      `https://docs.google.com/uc?export=download&id=${fileId}`,
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download`
    ];
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (trimmed.includes('/api/audio-proxy')) {
      return [trimmed];
    }
    return [trimmed, `/api/audio-proxy?url=${encodeURIComponent(trimmed)}`];
  }

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return [trimmed];
  }

  return [`data:audio/mp3;base64,${trimmed}`];
};

/**
 * Parses Google Drive input URL from teacher input and returns the canonical stream URL.
 */
export const parseGoogleDriveUrl = (inputUrl: string): { streamUrl: string; fileId: string | null; isDrive: boolean } => {
  if (!inputUrl) return { streamUrl: '', fileId: null, isDrive: false };
  const fileId = extractGoogleDriveFileId(inputUrl);

  if (fileId) {
    return {
      streamUrl: `/api/audio-proxy?id=${fileId}`,
      fileId,
      isDrive: true
    };
  }

  return {
    streamUrl: inputUrl.trim(),
    fileId: null,
    isDrive: false
  };
};

/**
 * Normalizes an audio URL for backward compatibility with older exam data.
 */
export const normalizeAudioUrl = (raw?: string): string => {
  const sources = getAudioSourceUrls(raw);
  return sources[0] || '';
};

export const formatAudioSrc = (raw?: string): string => {
  return normalizeAudioUrl(raw);
};
