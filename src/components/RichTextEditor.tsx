import React, { useEffect, useRef, useState } from 'react';
import Quill from 'quill';
import katex from 'katex';
import { Trash2 } from 'lucide-react';

// Attach katex to window so Quill can find it
if (typeof window !== 'undefined') {
  (window as any).katex = katex;
}
import 'quill/dist/quill.snow.css';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Sensible max width for high quality but compact exams
        const MAX_WIDTH = 800;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string); // fallback on error
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.82); // 82% quality balances sharpness perfectly with extreme size savings
        resolve(compressedBase64);
      };
      img.onerror = () => {
        resolve(event.target?.result as string); // fallback to original data url
      };
    };
    reader.onerror = () => {
      reject(new Error('File reading error'));
    };
  });
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange, placeholder, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (editorRef.current && !quillRef.current) {
      const imageHandler = () => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.setAttribute('multiple', 'true');
        input.click();

        input.onchange = async () => {
          const files = input.files;
          if (!files) return;

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
              const compressedBase64 = await compressImage(file);
              
              if (quillRef.current) {
                const range = quillRef.current.getSelection(true);
                quillRef.current.insertEmbed(range.index, 'image', compressedBase64);
                quillRef.current.setSelection(range.index + 1);
              }
            } catch (err) {
              console.error('Error compressing/inserting image:', err);
            }
          }
        };
      };

      quillRef.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: {
            container: [
              [{ 'header': [1, 2, false] }],
              ['bold', 'italic', 'underline', 'strike', 'formula'],
              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
              ['link', 'image'],
              ['clean']
            ],
            handlers: {
              image: imageHandler
            }
          }
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

  const handleAlign = (alignment: 'left' | 'center' | 'right' | 'none') => {
    if (selectedImage) {
      if (alignment === 'left') {
        selectedImage.style.float = 'left';
        selectedImage.style.display = 'inline-block';
        selectedImage.style.margin = '8px 12px 8px 0';
        selectedImage.style.clear = 'both';
      } else if (alignment === 'center') {
        selectedImage.style.float = 'none';
        selectedImage.style.display = 'block';
        selectedImage.style.margin = '12px auto';
        selectedImage.style.clear = 'none';
      } else if (alignment === 'right') {
        selectedImage.style.float = 'right';
        selectedImage.style.display = 'inline-block';
        selectedImage.style.margin = '8px 0 8px 12px';
        selectedImage.style.clear = 'both';
      } else {
        selectedImage.style.float = 'none';
        selectedImage.style.display = 'block';
        selectedImage.style.margin = '12px 0';
        selectedImage.style.clear = 'none';
      }

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
          className="absolute z-50 flex flex-col md:flex-row items-stretch md:items-center gap-2 bg-slate-900 text-white text-xs font-semibold p-2 rounded-xl shadow-xl border border-slate-700 -translate-x-1/2 min-w-[280px] max-w-[90vw]"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
          }}
        >
          {/* Sizing Section */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider mr-1">Lebar:</span>
            {['25%', '50%', '75%', '100%'].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => handleResize(pct)}
                className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[11px] ${
                  selectedImage.style.width === pct ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                {pct}
              </button>
            ))}
          </div>

          <div className="hidden md:block w-[1px] h-4 bg-slate-700" />

          {/* Alignment Section */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider mr-1">Posisi:</span>
            <button
              type="button"
              onClick={() => handleAlign('left')}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[11px] ${
                selectedImage.style.float === 'left' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              Kiri
            </button>
            <button
              type="button"
              onClick={() => handleAlign('center')}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[11px] ${
                selectedImage.style.float === 'none' && selectedImage.style.margin.includes('auto') ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              Tengah
            </button>
            <button
              type="button"
              onClick={() => handleAlign('right')}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[11px] ${
                selectedImage.style.float === 'right' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              Kanan
            </button>
            <button
              type="button"
              onClick={() => handleAlign('none')}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[11px] ${
                selectedImage.style.float === 'none' && !selectedImage.style.margin.includes('auto') ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
              }`}
            >
              Normal
            </button>
          </div>

          <div className="w-full md:w-[1px] h-[1px] md:h-4 bg-slate-700" />

          {/* Delete Action */}
          <button
            type="button"
            onClick={handleDelete}
            className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white transition flex items-center justify-center gap-1 cursor-pointer text-[11px]"
          >
            <Trash2 size={11} />
            Hapus
          </button>
        </div>
      )}
    </div>
  );
};
