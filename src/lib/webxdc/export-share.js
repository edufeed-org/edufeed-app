/** sessionStorage handoff from a channel app's sendToChat export to the
 *  article/wiki create routes (spec §5). One-shot by design. */
const KEY = 'webxdc:export';

/** Above this, sessionStorage's own quota (5-10MB, but shared with the rest
 * of the origin) is a real risk rather than a theoretical one — refuse to
 * stash instead of silently losing the export to a quota error later. */
const MAX_PLAIN_TEXT_LENGTH = 2_000_000;

/**
 * @param {{name: string, plainText: string}} file
 * @returns {boolean} whether the export was stashed
 */
export function stashExport(file) {
  if (file.plainText.length > MAX_PLAIN_TEXT_LENGTH) return false;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(file));
    return true;
  } catch {
    /* quota — the create page will just open empty */
    return false;
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
