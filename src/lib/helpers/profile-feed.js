/**
 * Profile feed helpers — maps event kinds to feed categories and filters items.
 */

/**
 * @typedef {Object} FeedCategory
 * @property {string} id
 * @property {number[]} kinds
 */

/** @type {FeedCategory[]} */
export const FEED_CATEGORIES = [
  { id: 'notes', kinds: [1] },
  { id: 'calendar', kinds: [31922, 31923] },
  { id: 'resources', kinds: [30142] },
  { id: 'articles', kinds: [30023] },
  { id: 'bookmarks', kinds: [39701, 9802, 1111] },
  { id: 'polls', kinds: [1068] }
];

/** All kinds included in the profile feed */
export const ALL_FEED_KINDS = FEED_CATEGORIES.flatMap((c) => c.kinds);

/** @type {Map<number, string>} */
const KIND_TO_CATEGORY = new Map();
for (const cat of FEED_CATEGORIES) {
  for (const kind of cat.kinds) {
    KIND_TO_CATEGORY.set(kind, cat.id);
  }
}

/**
 * Map an event kind to its feed filter category.
 * @param {number} kind
 * @returns {string | null}
 */
export function kindToFeedCategory(kind) {
  return KIND_TO_CATEGORY.get(kind) ?? null;
}

/**
 * Filter events by active feed categories.
 * @param {any[]} items
 * @param {Set<string>} activeCategories
 * @returns {any[]}
 */
export function filterFeedItems(items, activeCategories) {
  return items.filter((event) => {
    const category = kindToFeedCategory(event.kind);
    return category !== null && activeCategories.has(category);
  });
}

/**
 * @typedef {{ type: 'e' | 'a', value: string }} PinPointer
 */

/**
 * Extract the ordered pin pointers from a kind 10001 pin-list event:
 * `e`-tags reference regular events by id, `a`-tags addressable events by
 * `kind:pubkey:d` coordinate.
 *
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {PinPointer[]}
 */
export function pinnedPointersFromEvent(event) {
  /** @type {PinPointer[]} */
  const pointers = [];
  for (const tag of event?.tags || []) {
    if ((tag[0] === 'e' || tag[0] === 'a') && tag[1]) {
      pointers.push({ type: tag[0], value: tag[1] });
    }
  }
  return pointers;
}

/**
 * Whether a feed entry's underlying event is in the pin list. Bookmark
 * group entries have no single underlying event and are never pinned.
 *
 * @param {{ data?: { id?: string, kind?: number, pubkey?: string, tags?: string[][] } }} entry
 * @param {PinPointer[]} pointers
 * @returns {boolean}
 */
export function isEntryPinned(entry, pointers) {
  const event = entry?.data;
  if (!event?.id || !pointers?.length) return false;

  const dTag = event.tags?.find((t) => t[0] === 'd')?.[1];
  const coord =
    typeof event.kind === 'number' && event.kind >= 30000 && event.kind < 40000
      ? `${event.kind}:${event.pubkey}:${dTag || ''}`
      : null;

  return pointers.some(
    (p) => (p.type === 'e' && p.value === event.id) || (p.type === 'a' && p.value === coord)
  );
}
