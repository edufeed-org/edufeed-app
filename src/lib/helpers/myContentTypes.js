/**
 * Content-type registry for the "Meine Inhalte" surface.
 *
 * Maps the authored content types to their event kinds, create-flow key
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
 * @property {(event: { kind: number, tags?: string[][] }) => boolean} [match]
 *   Optional refinement for types that share a kind with another type: an
 *   event of a matching kind belongs to this type iff the predicate passes.
 *   Predicate types win over plain kind mapping in {@link eventToContentType}.
 * @property {string} ctaKey    Key into CONTENT_CREATION for the create flow.
 * @property {string} accent    CSS var reference (--ct-*, defined in app.css) for the per-type stripe/tag color.
 */

/**
 * A kind-30142 resource whose encodings include a webxdc package carries the
 * NIP-DC discovery marker tag (see `appendInteractiveTags` in
 * `educational/eventTags.js`).
 * @param {{ tags?: string[][] }} event
 */
function isInteractiveResourceEvent(event) {
  return (event.tags ?? []).some((t) => t[0] === 'm' && t[1] === 'application/x-webxdc');
}

/** @type {ContentTypeDef[]} — also defines shelf render order. */
export const CONTENT_TYPES = [
  { key: 'calendar', kinds: [31922, 31923], ctaKey: 'calendar', accent: 'var(--ct-calendar)' },
  { key: 'learning', kinds: [30142], ctaKey: 'learning', accent: 'var(--ct-learning)' },
  {
    key: 'interactive',
    kinds: [30142],
    match: isInteractiveResourceEvent,
    ctaKey: 'learning',
    accent: 'var(--ct-interactive)'
  },
  { key: 'article', kinds: [30023], ctaKey: 'article', accent: 'var(--ct-article)' },
  { key: 'wiki', kinds: [30818], ctaKey: 'wiki', accent: 'var(--ct-wiki)' },
  { key: 'form', kinds: [30168], ctaKey: 'form', accent: 'var(--ct-form)' },
  { key: 'poll', kinds: [1068], ctaKey: 'poll', accent: 'var(--ct-poll)' },
  { key: 'bookmark', kinds: [39701], ctaKey: 'bookmark', accent: 'var(--ct-bookmark)' }
];

/** Shelf render order (type keys). */
export const SHELF_ORDER = CONTENT_TYPES.map((t) => t.key);

/** All authored kinds across every type, deduped (shared kinds appear once). */
export const ALL_CONTENT_KINDS = [...new Set(CONTENT_TYPES.flatMap((t) => t.kinds))];

/** @type {Map<string, ContentTypeDef>} */
const BY_KEY = new Map(CONTENT_TYPES.map((t) => [t.key, t]));

/** @type {Map<number, string>} — plain kind mapping; predicate types excluded. */
const KIND_TO_KEY = new Map();
for (const t of CONTENT_TYPES) {
  if (t.match) continue;
  for (const kind of t.kinds) KIND_TO_KEY.set(kind, t.key);
}

/** Types with a refinement predicate, in registry order. */
const PREDICATE_TYPES = CONTENT_TYPES.filter((t) => t.match);

/**
 * @param {string} key
 * @returns {ContentTypeDef | undefined}
 */
export function getContentType(key) {
  return BY_KEY.get(key);
}

/**
 * Map an event kind to its (plain) content-type key.
 * @param {number} kind
 * @returns {string | undefined}
 */
export function kindToContentType(kind) {
  return KIND_TO_KEY.get(kind);
}

/**
 * Map an event to its content-type key. Predicate-refined types (e.g.
 * `interactive` within kind 30142) win over the plain kind mapping.
 * @param {{ kind: number, tags?: string[][], [key: string]: any }} event
 * @returns {string | undefined}
 */
export function eventToContentType(event) {
  for (const t of PREDICATE_TYPES) {
    if (t.kinds.includes(event.kind) && t.match?.(event)) return t.key;
  }
  return KIND_TO_KEY.get(event.kind);
}

/**
 * Group events into buckets keyed by content type, in SHELF_ORDER.
 * Events whose kind isn't a known content type are dropped.
 * @param {Array<{ kind: number, tags?: string[][], [key: string]: any }>} items
 * @returns {Record<string, any[]>}
 */
export function groupItemsByType(items) {
  /** @type {Record<string, any[]>} */
  const groups = {};
  for (const key of SHELF_ORDER) groups[key] = [];
  for (const item of items) {
    const key = eventToContentType(item);
    if (key) groups[key].push(item);
  }
  return groups;
}
