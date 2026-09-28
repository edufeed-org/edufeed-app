// Pure layout helpers for the call stage.

const ASPECT = 16 / 9;

/**
 * The column count that gives `count` 16:9 tiles the largest size inside a
 * `width` × `height` stage. Unmeasured stages (0 × 0, e.g. before layout or
 * in jsdom) get a square-ish grid and no pixel size.
 *
 * @param {number} count
 * @param {number} width
 * @param {number} height
 * @param {number} gap
 * @returns {{cols: number, rows: number, tileWidth: number, tileHeight: number}}
 */
export function fitGrid(count, width, height, gap) {
  if (count <= 0) return { cols: 1, rows: 0, tileWidth: 0, tileHeight: 0 };
  if (width <= 0 || height <= 0) {
    const cols = Math.ceil(Math.sqrt(count));
    return { cols, rows: Math.ceil(count / cols), tileWidth: 0, tileHeight: 0 };
  }
  let best = { cols: 1, rows: count, tileWidth: 0, tileHeight: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (width - gap * (cols - 1)) / cols;
    const byHeight = ((height - gap * (rows - 1)) / rows) * ASPECT;
    const tileWidth = Math.max(0, Math.min(byWidth, byHeight));
    if (tileWidth > best.tileWidth) {
      best = { cols, rows, tileWidth, tileHeight: tileWidth / ASPECT };
    }
  }
  return best;
}

/**
 * Spotlight bookkeeping. A screen share that was not on the stage before
 * takes the spotlight; a pinned item that left the stage is unpinned.
 * `seenShares` is the caller's memory of shares already on the stage and is
 * updated in place (a share that stops is forgotten, so restarting it is new).
 *
 * @param {string | null} pinned
 * @param {string[]} seatKeys
 * @param {string[]} shareKeys
 * @param {Set<string>} seenShares
 * @returns {string | null}
 */
export function nextSpotlight(pinned, seatKeys, shareKeys, seenShares) {
  let next = pinned;
  for (const key of shareKeys) {
    if (!seenShares.has(key)) {
      seenShares.add(key);
      next = key;
    }
  }
  for (const key of [...seenShares]) {
    if (!shareKeys.includes(key)) seenShares.delete(key);
  }
  if (next && !shareKeys.includes(next) && !seatKeys.includes(next)) next = null;
  return next;
}
