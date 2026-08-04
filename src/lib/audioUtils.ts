/**
 * Utility functions for handling audio URLs, Google Drive stream URLs,
 * and base64 audio data cleanly and reliably across the application.
 */

export const extractGoogleDriveFileId = (inputUrl?: string): string | null => {
  if (!inputUrl) return null;
  const trimmed = inputUrl.trim();

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
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed) && !trimmed.startsWith('http') && !trimmed.startsWith('data:')) {
    return trimmed;
  }

  return null;
};

export const getAudioSourceUrls = (raw?: string): string[] => {
  if (!raw) return [];
  const trimmed = raw.trim();

  const fileId = extractGoogleDriveFileId(trimmed);
  if (fileId) {
    return [
      `/api/audio-proxy?id=${fileId}`,
      `https://drive.google.com/uc?export=download&id=${fileId}`,
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
      `https://drive.google.com/uc?export=open&id=${fileId}`,
      `https://docs.google.com/uc?export=download&id=${fileId}`
    ];
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (trimmed.includes('api/audio-proxy')) {
      return [trimmed];
    }
    return [
      `/api/audio-proxy?url=${encodeURIComponent(trimmed)}`,
      trimmed
    ];
  }

  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return [trimmed];
  }

  return [`data:audio/mp3;base64,${trimmed}`];
};

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

export const formatAudioSrc = (raw?: string): string => {
  const sources = getAudioSourceUrls(raw);
  return sources[0] || '';
};
