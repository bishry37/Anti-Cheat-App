import React, { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import { Trash2 } from 'lucide-react';
import 'quill/dist/quill.snow.css';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (editorRef.current && !quillRef.current) {
      quillRef.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ 'header': [1, 2, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            ['link', 'image'],
            ['clean']
          ]
        },
        placeholder: placeholder
      });

      quillRef.current.on('text-change', () => {
        onChange(quillRef.current?.root.innerHTML || '');
      });

      const handleRootClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG') {
          const img = target as HTMLImageElement;
          setSelectedImage(img);
          
          // Calculate relative position to containerRef
          const imgRect = img.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            setToolbarPosition({
              top: imgRect.bottom - containerRect.top + (containerRef.current?.scrollTop || 0) + 8,
              left: imgRect.left + imgRect.width / 2 - containerRect.left,
            });
          }
        } else {
          setSelectedImage(null);
          setToolbarPosition(null);
        }
      };

      quillRef.current.root.addEventListener('click', handleRootClick);

      const handleSelectionChange = () => {
        // Clear selection if focus moves elsewhere
        const selection = quillRef.current?.getSelection();
        if (!selection) {
          setSelectedImage(null);
          setToolbarPosition(null);
        }
      };
      quillRef.current.on('selection-change', handleSelectionChange);

      return () => {
        quillRef.current?.root.removeEventListener('click', handleRootClick);
        quillRef.current?.off('selection-change', handleSelectionChange);
      };
    }
  }, [onChange, placeholder]);

  // Handle visual outline and shadow on the selected image
  useEffect(() => {
    if (quillRef.current) {
      quillRef.current.root.querySelectorAll('img').forEach((img) => {
        img.style.outline = 'none';
        img.style.boxShadow = 'none';
        img.style.transition = 'outline 0.15s ease, box-shadow 0.15s ease';
      });
    }
    if (selectedImage) {
      selectedImage.style.outline = '3px solid #3b82f6';
      selectedImage.style.boxShadow = '0 0 0 5px rgba(59, 130, 246, 0.25)';
    }
  }, [selectedImage]);

  useEffect(() => {
    if (quillRef.current && value !== quillRef.current.root.innerHTML) {
      quillRef.current.clipboard.dangerouslyPasteHTML(value);
    }
  }, [value]);

  const handleResize = (percentage: string) => {
    if (selectedImage) {
      selectedImage.style.width = percentage;
      selectedImage.style.height = 'auto';
      selectedImage.setAttribute('width', percentage);
      selectedImage.removeAttribute('height');

      if (quillRef.current) {
        onChange(quillRef.current.root.innerHTML || '');
      }

      // Re-calculate toolbar position
      setTimeout(() => {
        if (selectedImage && containerRef.current) {
          const imgRect = selectedImage.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          setToolbarPosition({
            top: imgRect.bottom - containerRect.top + 8,
            left: imgRect.left + imgRect.width / 2 - containerRect.left,
          });
        }
      }, 50);
    }
  };

  const handleDelete = () => {
    if (selectedImage) {
      selectedImage.remove();
      setSelectedImage(null);
      setToolbarPosition(null);
      if (quillRef.current) {
        onChange(quillRef.current.root.innerHTML || '');
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col">
      <div ref={editorRef} className={className} />
      
      {selectedImage && toolbarPosition && (
        <div
          className="absolute z-50 flex items-center gap-1 bg-slate-900 text-white text-xs font-semibold py-1 px-1.5 rounded-lg shadow-xl border border-slate-700 -translate-x-1/2"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
          }}
        >
          <button
            type="button"
            onClick={() => handleResize('25%')}
            className="px-2 py-1 rounded hover:bg-slate-800 transition cursor-pointer"
          >
            25%
          </button>
          <button
            type="button"
            onClick={() => handleResize('50%')}
            className="px-2 py-1 rounded hover:bg-slate-800 transition cursor-pointer"
          >
            50%
          </button>
          <button
            type="button"
            onClick={() => handleResize('75%')}
            className="px-2 py-1 rounded hover:bg-slate-800 transition cursor-pointer"
          >
            75%
          </button>
          <button
            type="button"
            onClick={() => handleResize('100%')}
            className="px-2 py-1 rounded hover:bg-slate-800 transition cursor-pointer"
          >
            100%
          </button>
          <div className="w-[1px] h-4 bg-slate-700 mx-1" />
          <button
            type="button"
            onClick={handleDelete}
            className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white transition flex items-center gap-1 cursor-pointer"
          >
            <Trash2 size={13} />
            Hapus
          </button>
        </div>
      )}
    </div>
  );
};
