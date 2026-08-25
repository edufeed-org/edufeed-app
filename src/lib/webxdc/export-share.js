/** sessionStorage handoff from a channel app's sendToChat export to the
 *  article/wiki create routes (spec §5). One-shot by design. */
const KEY = 'webxdc:export';

/** @param {{name: string, plainText: string}} file */
export function stashExport(file) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    /* quota — the create page will just open empty */
  }
}

/** @returns {{name: string, plainText: string} | null} */
export function takeExport() {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.name === 'string' && typeof parsed?.plainText === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** @param {string} name */
export function exportTitle(name) {
  return name.replace(/\.[^.]+$/, '');
}
