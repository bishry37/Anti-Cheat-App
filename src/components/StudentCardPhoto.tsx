import React, { useState, useEffect } from 'react';
import { UserCircle } from 'lucide-react';
import { formatPhotoUrl, getFallbackPhotoUrl } from '../utils/studentUtils';

interface StudentCardPhotoProps {
  photo?: string | null;
  studentName: string;
  className?: string;
  showPlaceholderLabel?: boolean;
  onStatusChange?: (status: 'empty' | 'loading' | 'success' | 'error') => void;
}

export const StudentCardPhoto: React.FC<StudentCardPhotoProps> = ({
  photo,
  studentName,
  className = 'w-12 h-16',
  showPlaceholderLabel = true,
  onStatusChange,
}) => {
  const formattedUrl = formatPhotoUrl(photo);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(formattedUrl);
  const [hasError, setHasError] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const formatted = formatPhotoUrl(photo);
    setCurrentSrc(formatted);
    setHasError(false);
    setTriedFallback(false);

    if (!formatted) {
      setIsLoading(false);
      onStatusChange?.('empty');
    } else {
      setIsLoading(true);
      onStatusChange?.('loading');
    }
  }, [photo, onStatusChange]);

  const handleError = () => {
    if (!triedFallback && photo) {
      const fallback = getFallbackPhotoUrl(photo);
      if (fallback && fallback !== currentSrc) {
        setTriedFallback(true);
        setCurrentSrc(fallback);
        return;
      }
    }
    setHasError(true);
    setIsLoading(false);
    onStatusChange?.('error');
  };

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
    onStatusChange?.('success');
  };

  // If photo is not uploaded/provided, or if the link is broken: display clean photo frame with simple silhouette
  if (!currentSrc || hasError) {
    return (
      <div 
        className={`bg-slate-100 border border-slate-300 rounded overflow-hidden shrink-0 flex flex-col items-center justify-center text-slate-400 select-none relative ${className}`}
        title={hasError ? "Foto tidak dapat dimuat (menampilkan siluet foto)" : "Frame Foto Peserta (Siluet)"}
      >
        <div className="w-full h-full flex flex-col items-center justify-center p-0.5 bg-gradient-to-b from-slate-50 to-slate-100">
          <UserCircle className="w-3/5 h-3/5 text-slate-300 stroke-[1.6]" />
          {showPlaceholderLabel && (
            <span className="text-[6.5px] font-black uppercase tracking-tighter text-slate-400 leading-none mt-0.5">
              2x3
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-slate-100 border border-slate-300 rounded overflow-hidden shrink-0 relative flex items-center justify-center ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-slate-100 flex items-center justify-center z-10">
          <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <img
        src={currentSrc}
        alt={studentName || 'Foto Siswa'}
        className="w-full h-full object-cover transition-opacity duration-200"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  );
};
