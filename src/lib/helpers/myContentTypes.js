/**
 * Content-type registry for the "Meine Inhalte" surface.
 *
 * Maps the seven authored content types to their event kinds, create-flow key
 * (see {@link CONTENT_CREATION} in `contentCreation.js`), and a per-type accent
 * color used for the color-coded stripes/tags in the dashboard.
 *
 * This module is pure (no Svelte/paraglide imports) so it stays unit-testable.
 * The render layer supplies the icon component and translated label per key.
 */

/**
 * @typedef {Object} ContentTypeDef
 * @property {string} key       Stable identifier, reused as the filter/create key.
 * @property {number[]} kinds   Nostr event kinds belonging to this type.
 * @property {string} ctaKey    Key into CONTENT_CREATION for the create flow.
 * @property {string} accent    OKLCH accent color (per-type stripe/tag color).
 */

/** @type {ContentTypeDef[]} — also defines shelf render order. */
export const CONTENT_TYPES = [
  { key: 'calendar', kinds: [31922, 31923], ctaKey: 'calendar', accent: 'oklch(52% 0.12 12)' },
  { key: 'learning', kinds: [30142], ctaKey: 'learning', accent: 'oklch(50% 0.10 140)' },
  { key: 'article', kinds: [30023], ctaKey: 'article', accent: 'oklch(58% 0.12 64)' },
  { key: 'wiki', kinds: [30818], ctaKey: 'wiki', accent: 'oklch(52% 0.07 200)' },
  { key: 'form', kinds: [30168], ctaKey: 'form', accent: 'oklch(52% 0.12 300)' },
  { key: 'poll', kinds: [1068], ctaKey: 'poll', accent: 'oklch(52% 0.11 250)' },
  { key: 'bookmark', kinds: [39701], ctaKey: 'bookmark', accent: 'oklch(52% 0.04 250)' }
];

/** Shelf render order (type keys). */
export const SHELF_ORDER = CONTENT_TYPES.map((t) => t.key);

/** All authored kinds across every type. */
export const ALL_CONTENT_KINDS = CONTENT_TYPES.flatMap((t) => t.kinds);

/** @type {Map<string, ContentTypeDef>} */
const BY_KEY = new Map(CONTENT_TYPES.map((t) => [t.key, t]));

/** @type {Map<number, string>} */
const KIND_TO_KEY = new Map();
for (const t of CONTENT_TYPES) {
  for (const kind of t.kinds) KIND_TO_KEY.set(kind, t.key);
}

/**
 * @param {string} key
 * @returns {ContentTypeDef | undefined}
 */
export function getContentType(key) {
  return BY_KEY.get(key);
}

/**
 * Map an event kind to its content-type key.
 * @param {number} kind
 * @returns {string | undefined}
 */
export function kindToContentType(kind) {
  return KIND_TO_KEY.get(kind);
}

/**
 * Group events into buckets keyed by content type, in SHELF_ORDER.
 * Events whose kind isn't a known content type are dropped.
 * @param {Array<{ kind: number, [key: string]: any }>} items
 * @returns {Record<string, any[]>}
 */
export function groupItemsByType(items) {
  /** @type {Record<string, any[]>} */
  const groups = {};
  for (const key of SHELF_ORDER) groups[key] = [];
  for (const item of items) {
    const key = kindToContentType(item.kind);
    if (key) groups[key].push(item);
  }
  return groups;
}
