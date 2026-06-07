export const formatHTML = (text: string | undefined | null): string => {
  if (!text) return '';
  const str = String(text);
  
  // If the text appears to already contain HTML formatting (e.g. from Quill)
  if (/<[a-z][\s\S]*>/i.test(str)) {
    return str;
  }
  
  // For plain text (like from Excel), split by newlines and wrap in <p> tags
  // to ensure proper vertical spacing (margin-bottom) via CSS.
  const lines = str.split(/\r?\n/);
  return lines.map(line => {
    const trimmed = line.trim();
    if (trimmed) {
       return `<p>${trimmed}</p>`;
    } else {
       return '<br/>';
    }
  }).join('');
};
