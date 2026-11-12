/** Pure text rules for Termi documents; `document-export.js` re-exports them. */
const DOC_WORDS = 250;

/** A heading first line (after a leading comment block) or ≥ 250 words. @param {string} text */
export function isDocumentAnswer(text) {
  const t = (text ?? '').trim().replace(/^<!--[\s\S]*?-->\s*/, '');
  return t.startsWith('# ') || t.split(/\s+/).filter(Boolean).length >= DOC_WORDS;
}

/**
 * The model's working notes before the document ("Gern – dafür hole ich mir
 * zuerst …") go: the export starts at the first `# ` heading or a LiaScript
 * `<!--` header; without either the whole text stays.
 * @param {string} text
 */
export const fromDocumentStart = (text) => {
  const t = (text ?? '').trim();
  const start = t.search(/^(?:<!--|#[ \t])/m);
  // only a short opening note, never a `# ` line inside a code block
  const note = start > 0 && start <= 400 && !t.slice(0, start).includes('```');
  return note ? t.slice(start) : t;
};
