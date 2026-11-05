import JSZip from 'jszip';

/**
 * Maps OMML / Unicode math symbols to standard LaTeX commands.
 */
const SYMBOL_MAP: Record<string, string> = {
  '±': '\\pm ',
  '∓': '\\mp ',
  '×': '\\times ',
  '÷': '\\div ',
  '·': '\\cdot ',
  '⋅': '\\cdot ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '≡': '\\equiv ',
  '∞': '\\infty ',
  '√': '\\sqrt ',
  'π': '\\pi ',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'ε': '\\epsilon ',
  'θ': '\\theta ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'σ': '\\sigma ',
  'ω': '\\omega ',
  'Δ': '\\Delta ',
  'Ω': '\\Omega ',
  '∑': '\\sum ',
  '∏': '\\prod ',
  '∫': '\\int ',
  '→': '\\to ',
  '←': '\\leftarrow ',
  '↔': '\\leftrightarrow ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊆': '\\subseteq ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '∠': '\\angle ',
  '⊥': '\\perp ',
  '°': '^{\\circ}',
  '%': '\\%',
  '…': '\\dots '
};

function getLocalName(node: Node): string {
  const el = node as Element;
  return (el.localName || el.nodeName.replace(/^.*:/, '')).toLowerCase();
}

function getAttr(elem: Element | null, name: string): string | null {
  if (!elem || !elem.getAttribute) return null;
  return elem.getAttribute(name) || elem.getAttribute('m:' + name) || elem.getAttribute('w:' + name);
}

function findChild(parent: Node | null, name: string): Element | null {
  if (!parent || !parent.childNodes) return null;
  const target = name.toLowerCase();
  for (let i = 0; i < parent.childNodes.length; i++) {
    const c = parent.childNodes[i];
    if (c.nodeType === 1 && getLocalName(c) === target) return c as Element;
  }
  return null;
}

function findChildren(parent: Node | null, name: string): Element[] {
  const res: Element[] = [];
  if (!parent || !parent.childNodes) return res;
  const target = name.toLowerCase();
  for (let i = 0; i < parent.childNodes.length; i++) {
    const c = parent.childNodes[i];
    if (c.nodeType === 1 && getLocalName(c) === target) res.push(c as Element);
  }
  return res;
}

function formatMathText(txt: string | null | undefined): string {
  if (!txt) return '';
  let res = '';
  for (const char of txt) {
    if (SYMBOL_MAP[char]) {
      res += SYMBOL_MAP[char];
    } else {
      res += char;
    }
  }
  return res;
}

/**
 * Recursively converts an OMML (Office Math Markup Language) DOM node into a LaTeX string.
 */
export function ommlToLatex(node: Node | null): string {
  if (!node) return '';
  if (node.nodeType === 3) { // Text node
    return formatMathText(node.nodeValue);
  }
  if (node.nodeType !== 1) return '';

  const el = node as Element;
  const tag = getLocalName(el);

  switch (tag) {
    case 'omath':
    case 'omathpara': {
      let inner = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        inner += ommlToLatex(el.childNodes[i]);
      }
      return inner.trim();
    }

    case 'f': { // Fraction
      const fPr = findChild(el, 'fpr');
      const typeElem = fPr ? findChild(fPr, 'type') : null;
      const typeVal = typeElem ? getAttr(typeElem, 'val') : '';
      const numElem = findChild(el, 'num');
      const denElem = findChild(el, 'den');
      const num = ommlToLatex(numElem);
      const den = ommlToLatex(denElem);
      if (typeVal === 'nobar') {
        return `\\binom{${num}}{${den}}`;
      }
      return `\\frac{${num}}{${den}}`;
    }

    case 'rad': { // Radical / Square Root / Nth Root
      const radPr = findChild(el, 'radpr');
      const degHide = radPr ? findChild(radPr, 'deghide') : null;
      const isHidden = degHide && (getAttr(degHide, 'val') === '1' || getAttr(degHide, 'val') === 'on');
      const degElem = findChild(el, 'deg');
      const eElem = findChild(el, 'e');
      const deg = (!isHidden && degElem) ? ommlToLatex(degElem).trim() : '';
      const e = ommlToLatex(eElem);
      if (deg) {
        return `\\sqrt[${deg}]{${e}}`;
      }
      return `\\sqrt{${e}}`;
    }

    case 'ssup': { // Superscript / Power
      const e = ommlToLatex(findChild(el, 'e'));
      const sup = ommlToLatex(findChild(el, 'sup'));
      return `{${e}}^{${sup}}`;
    }

    case 'ssub': { // Subscript
      const e = ommlToLatex(findChild(el, 'e'));
      const sub = ommlToLatex(findChild(el, 'sub'));
      return `{${e}}_{${sub}}`;
    }

    case 'ssubsup': { // Subscript & Superscript
      const e = ommlToLatex(findChild(el, 'e'));
      const sub = ommlToLatex(findChild(el, 'sub'));
      const sup = ommlToLatex(findChild(el, 'sup'));
      return `{${e}}_{${sub}}^{${sup}}`;
    }

    case 'spre': { // Pre-Sub-Superscript
      const e = ommlToLatex(findChild(el, 'e'));
      const sub = ommlToLatex(findChild(el, 'sub'));
      const sup = ommlToLatex(findChild(el, 'sup'));
      return `{}_{${sub}}^{${sup}}{${e}}`;
    }

    case 'd': { // Delimiter (parentheses, brackets, absolute value)
      const dPr = findChild(el, 'dpr');
      const begElem = dPr ? findChild(dPr, 'begchr') : null;
      const endElem = dPr ? findChild(dPr, 'endchr') : null;
      const beg = begElem ? (getAttr(begElem, 'val') || '(') : '(';
      const end = endElem ? (getAttr(endElem, 'val') || ')') : ')';

      const mapDelim = (ch: string, isLeft: boolean) => {
        if (!ch) return isLeft ? '\\left.' : '\\right.';
        if (ch === '(') return '\\left(';
        if (ch === ')') return '\\right)';
        if (ch === '[') return '\\left[';
        if (ch === ']') return '\\right]';
        if (ch === '{') return '\\left\\{';
        if (ch === '}') return '\\right\\}';
        if (ch === '|') return isLeft ? '\\left|' : '\\right|';
        return isLeft ? `\\left${ch}` : `\\right${ch}`;
      };

      const eList = findChildren(el, 'e');
      const contents = eList.map(item => ommlToLatex(item)).join(', ');
      return `${mapDelim(beg, true)} ${contents} ${mapDelim(end, false)}`;
    }

    case 'nary': { // N-ary: Integrals, Summations, Products
      const naryPr = findChild(el, 'narypr');
      const chrElem = naryPr ? findChild(naryPr, 'chr') : null;
      const opChar = chrElem ? (getAttr(chrElem, 'val') || '∫') : '∫';

      const opMap: Record<string, string> = {
        '∫': '\\int',
        '∬': '\\iint',
        '∭': '\\iiint',
        '∮': '\\oint',
        '∑': '\\sum',
        '∏': '\\prod',
        '⋃': '\\bigcup',
        '⋂': '\\bigcap'
      };
      const opLatex = opMap[opChar] || opChar;

      const subElem = findChild(el, 'sub');
      const supElem = findChild(el, 'sup');
      const eElem = findChild(el, 'e');
      const sub = subElem ? ommlToLatex(subElem).trim() : '';
      const sup = supElem ? ommlToLatex(supElem).trim() : '';
      const e = ommlToLatex(eElem);

      let res = opLatex;
      if (sub) res += `_{${sub}}`;
      if (sup) res += `^{${sup}}`;
      return `${res} {${e}}`;
    }

    case 'func': { // Function (sin, cos, tan, log, etc.)
      const fName = ommlToLatex(findChild(el, 'fname')).trim();
      const e = ommlToLatex(findChild(el, 'e'));
      const standardFuncs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min'];
      if (standardFuncs.includes(fName.toLowerCase())) {
        return `\\${fName.toLowerCase()}(${e})`;
      }
      return `{\\mathrm{${fName}}}(${e})`;
    }

    case 'limlow': { // Lower Limit, e.g. lim_{x \to 0}
      const e = ommlToLatex(findChild(el, 'e'));
      const lim = ommlToLatex(findChild(el, 'lim'));
      return `{${e}}_{${lim}}`;
    }

    case 'limupp': { // Upper Limit
      const e = ommlToLatex(findChild(el, 'e'));
      const lim = ommlToLatex(findChild(el, 'lim'));
      return `{${e}}^{${lim}}`;
    }

    case 'bar': { // Overline / Underline
      const barPr = findChild(el, 'barpr');
      const posElem = barPr ? findChild(barPr, 'pos') : null;
      const pos = posElem ? getAttr(posElem, 'val') : 'top';
      const e = ommlToLatex(findChild(el, 'e'));
      return pos === 'bot' ? `\\underline{${e}}` : `\\overline{${e}}`;
    }

    case 'acc': { // Accent: hat, vec, bar, dot
      const accPr = findChild(el, 'accpr');
      const chrElem = accPr ? findChild(accPr, 'chr') : null;
      const chr = chrElem ? getAttr(chrElem, 'val') : '̂';
      const e = ommlToLatex(findChild(el, 'e'));
      const accMap: Record<string, string> = {
        '̂': `\\hat{${e}}`,
        '^': `\\hat{${e}}`,
        '⃗': `\\vec{${e}}`,
        '̄': `\\bar{${e}}`,
        '̇': `\\dot{${e}}`,
        '̈': `\\ddot{${e}}`,
        '̃': `\\tilde{${e}}`
      };
      return accMap[chr || '̂'] || `\\hat{${e}}`;
    }

    case 'groupchr': { // Overbrace / Underbrace
      const gPr = findChild(el, 'groupchrpr');
      const posElem = gPr ? findChild(gPr, 'pos') : null;
      const pos = posElem ? getAttr(posElem, 'val') : 'top';
      const e = ommlToLatex(findChild(el, 'e'));
      return pos === 'bot' ? `\\underbrace{${e}}` : `\\overbrace{${e}}`;
    }

    case 'm': { // Matrix
      const rows = findChildren(el, 'mr');
      const rowsLatex = rows.map(r => {
        const cells = findChildren(r, 'e');
        return cells.map(c => ommlToLatex(c)).join(' & ');
      }).join(' \\\\ ');
      return `\\begin{matrix} ${rowsLatex} \\end{matrix}`;
    }

    case 'eqarr': { // Equation Array
      const eqs = findChildren(el, 'e');
      return `\\begin{aligned} ${eqs.map(item => ommlToLatex(item)).join(' \\\\ ')} \\end{aligned}`;
    }

    case 'box': {
      return `{${ommlToLatex(findChild(el, 'e'))}}`;
    }

    case 'r': { // Run
      let rText = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        rText += ommlToLatex(el.childNodes[i]);
      }
      return rText;
    }

    case 't': { // Text
      return formatMathText(el.textContent || '');
    }

    default: {
      let out = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        out += ommlToLatex(el.childNodes[i]);
      }
      return out;
    }
  }
}

/**
 * Escapes XML special characters for safe insertion into Word document.xml.
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Preprocesses a Word (.docx) file ArrayBuffer by converting Word Equation Editor (OMML)
 * structures into standard LaTeX delimited math equations \( ... \) inside Word text runs (<w:r><w:t>...</w:t></w:r>).
 * This allows Mammoth to convert the document without losing formulas.
 */
export async function preprocessDocxMath(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXmlFile = zip.file('word/document.xml');
    if (!documentXmlFile) {
      return arrayBuffer;
    }

    let docXml = await documentXmlFile.async('text');

    // Quick check if document.xml contains any OMML elements
    if (!docXml.includes('oMath')) {
      return arrayBuffer;
    }

    // Parse XML using DOMParser
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXml, 'application/xml');

    // Find all top-level math containers
    // We look for elements whose localName is 'omathpara' or 'omath' (that are not inside another omath)
    const allMathElements = Array.from(xmlDoc.getElementsByTagName('*')).filter(el => {
      const name = (el.localName || el.nodeName.replace(/^.*:/, '')).toLowerCase();
      return name === 'omathpara' || name === 'omath';
    });

    // Filter to only top-level equations to avoid double replacement of nested oMath
    const topLevelMathElements: Element[] = [];
    allMathElements.forEach(el => {
      let parent = el.parentElement;
      let isNested = false;
      while (parent) {
        const parentName = (parent.localName || parent.nodeName.replace(/^.*:/, '')).toLowerCase();
        if (parentName === 'omathpara' || parentName === 'omath') {
          isNested = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!isNested) {
        topLevelMathElements.push(el);
      }
    });

    if (topLevelMathElements.length === 0) {
      return arrayBuffer;
    }

    // Replace each top-level math element with a Word text run containing LaTeX
    topLevelMathElements.forEach(mathEl => {
      const latex = ommlToLatex(mathEl).trim();
      if (!latex) return;

      const escapedLatex = escapeXml(`\\(${latex}\\)`);
      // Create replacement node using XML fragment
      const replacementXml = `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t xml:space="preserve"> ${escapedLatex} </w:t></w:r>`;
      const repDoc = parser.parseFromString(replacementXml, 'application/xml');
      const repNode = xmlDoc.importNode(repDoc.documentElement, true);

      mathEl.parentNode?.replaceChild(repNode, mathEl);
    });

    // Serialize modified XML back to string
    const serializer = new XMLSerializer();
    const modifiedXml = serializer.serializeToString(xmlDoc);

    zip.file('word/document.xml', modifiedXml);

    const modifiedArrayBuffer = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE'
    });

    return modifiedArrayBuffer;
  } catch (err) {
    console.warn('preprocessDocxMath encountered an error, falling back to original arrayBuffer:', err);
    return arrayBuffer;
  }
}
