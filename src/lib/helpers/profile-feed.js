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
  { id: 'bookmarks', kinds: [39701, 9802, 1111] }
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
