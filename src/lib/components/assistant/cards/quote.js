/**
 * A passage chunk as a readable quote: nope-mcp chunks start and end mid-word
 * ("nn, wenn eigene …"); trim both ends to whole words and mark each cut with "…".
 * @param {unknown} text
 * @param {number} [max]
 */
export function clampQuote(text, max = 300) {
  let t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  let head = false;
  let tail = false;
  // shortcut: a lowercase start is read as a word fragment, so a chunk that starts
  // at a whole lowercase word loses that word; upgrade if nope-mcp ever flags chunk offsets.
  const firstSpace = t.indexOf(' ');
  if (/^\p{Ll}/u.test(t) && firstSpace > 0) {
    t = t.slice(firstSpace + 1);
    head = true;
  }
  if (t.endsWith('…')) {
    t = t.slice(0, -1);
    const i = t.lastIndexOf(' ');
    if (i > 0) t = t.slice(0, i);
    tail = true;
  }
  if (t.length > max) {
    const cut = t.slice(0, max + 1); // one extra char: a word ending exactly at max is whole
    const i = cut.lastIndexOf(' ');
    t = i > 0 ? cut.slice(0, i) : t.slice(0, max);
    tail = true;
  }
  if (tail) t = t.replace(/[\s,;:]+$/, '');
  return t ? `${head ? '…' : ''}${t}${tail ? '…' : ''}` : '';
}
