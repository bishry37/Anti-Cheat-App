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
 * Synchronously renders all math formulas in a string (Quill formulas, \(...\), \[...\], $$...$$, $...$, bare \frac, \sqrt, etc.)
 * into inline KaTeX HTML markup.
 */
export const renderMathInString = (content: string | null | undefined): string => {
  if (!content) return '';
  let str = String(content);

  // Normalize double-escaped backslashes before latex delimiters or control sequences
  str = str.replace(/\\\\([a-zA-Z()\[\]\$])/g, '\\$1');

  // 1. Convert Quill formula elements <span class="ql-formula" data-value="...">...</span>
  str = str.replace(/<span[^>]*class="[^"]*ql-formula[^"]*"[^>]*data-value="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, (full, tex) => {
    try {
      const decodedTex = tex.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      return katex.renderToString(decodedTex, { throwOnError: false, displayMode: false });
    } catch {
      return full;
    }
  });

  // Helper to safely render a TeX string with KaTeX
  const safeRender = (tex: string, displayMode: boolean): string => {
    try {
      const cleanTex = tex.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      return katex.renderToString(cleanTex, { throwOnError: false, displayMode });
    } catch {
      return tex;
    }
  };

  // 2. Render delimited display equations: $$ ... $$ or \[ ... \]
  str = str.replace(/(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/g, (full, _, tex1, tex2) => {
    const tex = (tex1 || tex2 || '').trim();
    if (!tex) return full;
    return safeRender(tex, true);
  });

  // 3. Render delimited inline equations: \( ... \) or $ ... $
  str = str.replace(/(\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$)/g, (full, _, tex1, tex2) => {
    const tex = (tex1 || tex2 || '').trim();
    if (!tex) return full;
    if (full.startsWith('$') && !full.startsWith('\\(')) {
      if (/^\d+(\.\d+)?$/.test(tex)) return full;
    }
    return safeRender(tex, false);
  });

  // 4. Render bare full-equation candidates in plain text segments (e.g. \frac{\sin x}{\cos x}, \sin(30^\circ), \cos \theta = \frac{1}{2})
  str = str.replace(/(>|^)([^<]*\\[a-zA-Z]+[^<]*)(<|$)/g, (full, open, text, close) => {
    if (!text.includes('\\')) return full;

    // Check if there is an option label prefix like "A. " or "1. "
    const prefixMatch = text.match(/^([A-Ea-e1-9]\s*[\.\):\-]\s*)(.*)$/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    const mathCandidate = prefixMatch ? prefixMatch[2].trim() : text.trim();

    // If the candidate looks like a pure math expression, try rendering the entire expression with KaTeX
    if (mathCandidate && !/[a-zA-Z]{5,}/.test(mathCandidate.replace(/\\[a-zA-Z]+/g, ''))) {
      try {
        const rendered = katex.renderToString(mathCandidate, { throwOnError: false, displayMode: false });
        if (rendered && !rendered.includes('katex-error')) {
          return `${open}${prefix}${rendered}${close}`;
        }
      } catch {
        // Fallback to pattern replacements below
      }
    }
    return full;
  });

  // 5. Render bare LaTeX commands like \frac{a}{b}, \frac 1 2, \sqrt{a}, etc.
  str = str.replace(/(\\(?:frac|dfrac|tfrac)\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[0-9a-zA-Z])(?:\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[0-9a-zA-Z]))?)/g, (full, tex) => {
    return safeRender(tex, false);
  });

  // 6. Render bare roots like \sqrt{x}, \sqrt[3]{x}, etc.
  str = str.replace(/(\\(?:sqrt|cbrt)(?:\[[^\]]*\])?\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[0-9a-zA-Z]))/g, (full, tex) => {
    return safeRender(tex, false);
  });

  // 7. Render trigonometry and logarithmic functions like \sin(x), \cos(\theta), \tan 45^\circ, \log(x), \ln(x)
  str = str.replace(/(\\(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|exp|lim)\b(?:\^[0-9a-zA-Z]+)?(?:\s*\{[^{}]*\}|\s*\([^)]*\)|\s*[0-9a-zA-Z]+(?:\^[0-9a-zA-Z]+)?)?)/g, (full, tex) => {
    return safeRender(tex, false);
  });

  // 8. Render bare standalone LaTeX symbols like \pm, \times, \div, \le, \ge, \ne, \approx, \infty, \pi, \alpha, \beta, \theta, etc.
  str = str.replace(/(?<![\w\\])(\\(?:pm|times|div|cdot|le|ge|ne|approx|equiv|infty|pi|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|Delta|Omega|degree|circ|to|leftarrow|leftrightarrow|in|notin|subset|subseteq|cup|cap|angle|perp))\b/g, (full, tex) => {
    return safeRender(tex, false);
  });

  return str;
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
