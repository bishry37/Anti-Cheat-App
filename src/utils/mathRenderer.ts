import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';

/**
 * Automatically wraps bare LaTeX commands (e.g. \frac{1}{2}, \sqrt{16}, \sum_{i=1}^n, etc.)
 * in $...$ if they are not already enclosed within $ or $$ delimiters.
 */
export const wrapBareLaTeX = (content: string | null | undefined): string => {
  if (!content) return '';
  const str = String(content);
  
  // Protect already-delimited math blocks: \(...\), \[...\], $$...$$, and $...$
  const preserved: string[] = [];
  const maskToken = '___PRESERVED_MATH_BLOCK_';
  
  const masked = str.replace(
    /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$)/g,
    (match) => {
      const idx = preserved.length;
      preserved.push(match);
      return `${maskToken}${idx}___`;
    }
  );
  
  // Replace bare common math commands like \frac{...}{...}, \sqrt{...}, etc.
  const wrapped = masked.replace(
    /(?<![\$\\\w])(\\(?:frac|sqrt|cbrt|sum|int|lim|prod)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?:\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})?)(?![\$])/g,
    '$$$1$$'
  );
  
  // Restore preserved blocks
  return wrapped.replace(/___PRESERVED_MATH_BLOCK_(\d+)___/g, (_, idx) => preserved[Number(idx)] || '');
};

/**
 * Scans all elements matching selector (or within the container)
 * and renders:
 * 1. Quill formulas (.ql-formula[data-value])
 * 2. LaTeX/TeX delimiters ($...$, $$...$$, \(...\), \[...\], \begin{equation}, etc.)
 */
export const renderMathInContainers = (targetOrSelector: string | HTMLElement = '.ql-editor') => {
  try {
    const elements: HTMLElement[] = typeof targetOrSelector === 'string'
      ? Array.from(document.querySelectorAll<HTMLElement>(targetOrSelector))
      : [targetOrSelector];

    elements.forEach(container => {
      if (!container) return;

      // 1. Render Quill formula tags
      const quillFormulas = container.querySelectorAll('.ql-formula');
      quillFormulas.forEach(f => {
        const tex = f.getAttribute('data-value');
        if (tex) {
          try {
            katex.render(tex, f as HTMLElement, {
              throwOnError: false,
              displayMode: false
            });
          } catch (e) {
            console.warn('Quill formula KaTeX render error:', e);
          }
        }
      });

      // 2. Render all standard math delimiters using KaTeX auto-render extension
      try {
        renderMathInElement(container, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\begin{equation}', right: '\\end{equation}', display: true },
            { left: '\\begin{align}', right: '\\end{align}', display: true },
            { left: '\\begin{alignat}', right: '\\end{alignat}', display: true },
            { left: '\\begin{gather}', right: '\\end{gather}', display: true },
            { left: '\\begin{CD}', right: '\\end{CD}', display: true },
            { left: '\\begin{matrix}', right: '\\end{matrix}', display: false },
            { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', display: false },
            { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', display: false }
          ],
          throwOnError: false,
          errorColor: '#cc0000',
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
          ignoredClasses: ['katex', 'katex-display']
        });
      } catch (autoErr) {
        console.warn('Auto-render math error:', autoErr);
      }
    });
  } catch (err) {
    console.warn('renderMathInContainers error:', err);
  }
};
