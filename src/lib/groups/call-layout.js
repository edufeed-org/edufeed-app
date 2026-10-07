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
 * The stage layouts a viewer can pick. `grid`: everyone in the paginated
 * grid, a pin gives a spotlight. `focus`: always one spotlight + strip.
 * `side`: two spotlights side by side + strip. `speaker`: the active
 * speaker in the spotlight + strip.
 * @type {readonly ['grid', 'focus', 'side', 'speaker']}
 */
export const CALL_LAYOUTS = /** @type {const} */ (['grid', 'focus', 'side', 'speaker']);
/** @typedef {(typeof CALL_LAYOUTS)[number]} CallLayout */

/** How many spotlight slots a layout has when nothing is pinned. */
const SLOTS = { grid: 0, focus: 1, side: 2, speaker: 1 };

/**
 * How many items a viewer may pin in a layout: side by side takes two,
 * every other layout one (a second pin replaces the first).
 * @param {CallLayout} layout
 */
export function maxPins(layout) {
  return layout === 'side' ? 2 : 1;
}

/**
 * Pin or unpin `key`. New pins go last; past `max`, the oldest pin goes.
 * @param {string[]} pins
 * @param {string} key
 * @param {number} max
 * @returns {string[]}
 */
export function togglePinKey(pins, key, max) {
  if (pins.includes(key)) return pins.filter((k) => k !== key);
  return [...pins, key].slice(-Math.max(1, max));
}

/**
 * Pin bookkeeping between renders. A screen share that was not on the
 * stage before is pinned (it takes a spotlight slot); a pin whose item left
 * the stage is dropped; at most `max` pins stay (newest win). `seenShares`
 * is the caller's memory of shares already on the stage and is updated in
 * place (a share that stops is forgotten, so restarting it is new).
 *
 * @param {string[]} pins
 * @param {string[]} itemKeys everything on the stage
 * @param {string[]} shareKeys the shares that may auto-pin (remote ones)
 * @param {Set<string>} seenShares
 * @param {number} max
 * @returns {string[]} the same array when nothing changed
 */
export function nextPins(pins, itemKeys, shareKeys, seenShares, max) {
  let next = pins;
  for (const key of shareKeys) {
    if (!seenShares.has(key)) {
      seenShares.add(key);
      next = [...next.filter((k) => k !== key), key];
    }
  }
  for (const key of [...seenShares]) {
    if (!shareKeys.includes(key)) seenShares.delete(key);
  }
  const present = next.filter((k) => itemKeys.includes(k)).slice(-Math.max(1, max));
  if (present.length !== pins.length || present.some((k, i) => k !== pins[i])) return present;
  return pins;
}

/**
 * Which items fill the spotlight slots, and which go to the strip.
 *
 * Pins come first. The remaining slots are filled from the layout's own
 * candidates: focus and side prefer the newest remote screen share, then
 * the active speaker; speaker prefers the active speaker, then a share.
 * After that, anyone remote, then anyone at all — so a one-person call
 * still shows that person big in focus mode.
 *
 * @param {{
 *   layout: CallLayout,
 *   pins: string[],
 *   itemKeys: string[],
 *   remoteShareKeys: string[],  // oldest first
 *   speakerKey: string | null,
 *   localKeys: string[]
 * }} input
 * @returns {{slots: string[], strip: string[]}}
 */
export function pickStage({ layout, pins, itemKeys, remoteShareKeys, speakerKey, localKeys }) {
  const slotCount = Math.max(SLOTS[layout] ?? 0, Math.min(pins.length, maxPins(layout)));
  if (slotCount === 0 || itemKeys.length === 0) return { slots: [], strip: [] };
  const sharesNewestFirst = [...remoteShareKeys].reverse();
  const remote = itemKeys.filter((k) => !localKeys.includes(k));
  const chain =
    layout === 'speaker'
      ? [...pins, speakerKey, ...sharesNewestFirst, ...remote, ...itemKeys]
      : [...pins, ...sharesNewestFirst, speakerKey, ...remote, ...itemKeys];
  /** @type {string[]} */
  const slots = [];
  for (const key of chain) {
    if (!key || slots.includes(key) || !itemKeys.includes(key)) continue;
    slots.push(key);
    if (slots.length === slotCount) break;
  }
  return { slots, strip: itemKeys.filter((k) => !slots.includes(k)) };
}

/**
 * The grid's page window: `pageSize` tiles per page, `page` clamped to the
 * pages that exist (a page that emptied — people left — falls back to the
 * last one).
 * @param {number} count
 * @param {number} page zero-based
 * @param {number} pageSize
 * @returns {{page: number, pageCount: number, start: number, end: number}}
 */
export function paginate(count, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1);
  return {
    page: current,
    pageCount,
    start: current * size,
    end: Math.min(count, (current + 1) * size)
  };
}
