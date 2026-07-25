import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { TemplateMetadata } from '../types';

interface AudioPlayerProps {
  metadata: TemplateMetadata;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ metadata }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playedCount, setPlayedCount] = useState(0);

  useEffect(() => {
    if (audioRef.current) {
        audioRef.current.onloadedmetadata = () => {
            setDuration(audioRef.current!.duration);
        };
        audioRef.current.ontimeupdate = () => {
            setCurrentTime(audioRef.current!.currentTime);
        };
        audioRef.current.onended = () => {
            setIsPlaying(false);
            setPlayedCount(prev => prev + 1);
        };
    }
  }, []);

  const togglePlay = () => {
    if (!metadata.isAudioRepeatable && playedCount >= 1) return;

    if (isPlaying) {
      audioRef.current?.pause();
    } else {
      audioRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-6">
      <audio ref={audioRef} src={metadata.audioUrl} />
      <div className="flex items-center gap-4">
        <button 
            onClick={togglePlay}
            disabled={!metadata.isAudioRepeatable && playedCount >= 1}
            className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-800">{metadata.audioFileName}</p>
          <div className="h-2 bg-slate-200 rounded-full mt-2">
            <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
             {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / 
             {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
          </p>
        </div>
      </div>
      {!metadata.isAudioRepeatable && (
          <p className="text-[10px] text-red-600 font-bold mt-2 uppercase tracking-wide">
              Audio hanya dapat diputar satu kali.
          </p>
      )}
    </div>
  );
};
