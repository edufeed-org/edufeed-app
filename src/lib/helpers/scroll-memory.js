// Session-scoped scroll positions per chat container (laoc, 2026-08-11:
// switching communities should land on the spot you left, and a first visit
// should land on the newest message).
//
// Deliberately in-memory only: a scroll offset is worthless across sessions
// (the window of loaded messages differs), and persisting it would pin users
// to stale coordinates.

/** @typedef {{ top: number, atBottom: boolean }} ScrollPosition */

/** @type {Map<string, ScrollPosition>} */
const positions = new Map();

/** Test seam. */
export function __resetScrollMemory() {
  positions.clear();
}

/**
 * @param {string | null | undefined} key
 * @param {ScrollPosition} position
 */
export function saveScrollPosition(key, position) {
  if (key) positions.set(key, position);
}

/**
 * @param {string | null | undefined} key
 * @returns {ScrollPosition | null}
 */
export function recallScrollPosition(key) {
  return (key && positions.get(key)) || null;
}

/**
 * Whether the reader is close enough to the newest message that new arrivals
 * should keep the view pinned there (Discord behaviour).
 * @param {{scrollTop: number, scrollHeight: number, clientHeight: number}} el
 */
export function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}
