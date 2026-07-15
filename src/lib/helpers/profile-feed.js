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
  { id: 'bookmarks', kinds: [39701, 1111] },
  { id: 'highlights', kinds: [9802] },
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
 * Select/hide selection for the feed category chips (issue #35, extended to
 * multi-select), following the chart-legend convention of the calendar
 * top-publishers filter: chip body click = toggle in/out of the selected
 * set, eye button = hide/exclude. A non-empty selection takes precedence
 * over the hidden list, which stays intact for restore.
 *
 * @typedef {Object} CategorySelection
 * @property {string[]} selected
 * @property {string[]} hidden
 */

/**
 * Toggle a category in the selected set: add on first click, remove on the
 * second. Selecting a hidden category also un-hides it.
 * @param {CategorySelection} selection
 * @param {string} id
 * @returns {CategorySelection}
 */
export function toggleSelectedCategory(selection, id) {
  if (selection.selected.includes(id)) {
    return { selected: selection.selected.filter((s) => s !== id), hidden: [...selection.hidden] };
  }
  return {
    selected: [...selection.selected, id],
    hidden: selection.hidden.filter((h) => h !== id)
  };
}

/**
 * Toggle a category on the hidden list. Hiding a selected category would
 * contradict the selection — it is removed from the selected set instead.
 * @param {CategorySelection} selection
 * @param {string} id
 * @returns {CategorySelection}
 */
export function toggleHiddenCategory(selection, id) {
  const selected = selection.selected.filter((s) => s !== id);
  const hidden = selection.hidden.includes(id)
    ? selection.hidden.filter((h) => h !== id)
    : [...selection.hidden, id];
  return { selected, hidden };
}

/**
 * Chart-legend category membership for a feed entry (issue #45).
 * 'shared' is not kind-driven: it matches any entry carrying repost
 * metadata. Group entries (bookmark-url / bookmark-ref) belong to
 * 'bookmarks'. Everything else matches by entry type.
 * @param {{type: string, repost?: object}} entry
 * @param {string} categoryId
 * @returns {boolean}
 */
export function entryMatchesCategory(entry, categoryId) {
  if (categoryId === 'shared') return !!entry.repost;
  if (categoryId === 'bookmarks')
    return (
      entry.type === 'bookmarks' || entry.type === 'bookmark-url' || entry.type === 'bookmark-ref'
    );
  return entry.type === categoryId;
}

/**
 * Dual-membership visibility: with a non-empty selection, the entry must
 * match ANY selected category (hidden list ignored — selection wins,
 * mirroring the calendar filter); without one, the entry is hidden when ANY
 * of its categories is hidden.
 * @param {{type: string, repost?: object}} entry
 * @param {CategorySelection} selection
 * @returns {boolean}
 */
export function entryVisible(entry, selection) {
  if (selection.selected.length > 0) {
    return selection.selected.some((id) => entryMatchesCategory(entry, id));
  }
  return !selection.hidden.some((id) => entryMatchesCategory(entry, id));
}

/**
 * Resolve a selection to the set of active category ids: the selected set
 * when non-empty, otherwise all ids minus the hidden ones.
 * @param {CategorySelection} selection
 * @param {string[]} allIds
 * @returns {Set<string>}
 */
export function effectiveActiveCategories(selection, allIds) {
  if (selection.selected.length > 0) return new Set(selection.selected);
  return new Set(allIds.filter((id) => !selection.hidden.includes(id)));
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
