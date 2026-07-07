/**
 * Profile tab configuration helpers — kind 30078 (NIP-78) app data.
 *
 * The owner's tab arrangement is stored as an addressable event with
 * d="edufeed:profile-tabs". Tag order defines tab order:
 *   ["tab", "<id>"]            visible tab
 *   ["tab", "<id>", "hidden"]  hidden tab (owner's "Ausgeblendet" tray)
 * The id namespace reserves the "spell:<event-id>" prefix for future
 * custom tabs backed by kind-777 spells; those entries are ignored for now.
 */
import { kindToFeedCategory } from '$lib/helpers/profile-feed.js';

/** @type {string[]} */
export const PROFILE_TAB_IDS = [
  'posts',
  'content',
  'articles',
  'events',
  'polls',
  'bookmarks',
  'communities',
  'badges'
];

/** @type {string[]} */
export const DEFAULT_TAB_ORDER = [...PROFILE_TAB_IDS];

export const PROFILE_TABS_D_TAG = 'edufeed:profile-tabs';

/** Kinds backing each timeline tab (communities/badges have their own loaders). */
export const TAB_KINDS = {
  content: [30142],
  articles: [30023],
  events: [31922, 31923],
  polls: [1068],
  bookmarks: [39701, 9802, 1111]
};

const KNOWN_IDS = new Set(PROFILE_TAB_IDS);

/** feed category id (profile-feed.js) → tab id
 * @type {Record<string, string>} */
const CATEGORY_TO_TAB = {
  notes: 'posts',
  resources: 'content',
  articles: 'articles',
  calendar: 'events',
  polls: 'polls',
  bookmarks: 'bookmarks'
};

/**
 * Bucket loaded feed events into per-tab counts. The posts tab is the mixed
 * feed, so its count is the total across all feed kinds. Counts are
 * approximate (limited by what the loaders fetched) — display only.
 *
 * @param {Array<{ kind: number }> | null | undefined} events
 * @returns {Record<string, number>}
 */
export function tabCountsFromEvents(events) {
  /** @type {Record<string, number>} */
  const counts = { posts: 0, content: 0, articles: 0, events: 0, polls: 0, bookmarks: 0 };
  for (const event of events || []) {
    const category = kindToFeedCategory(event.kind);
    if (!category) continue;
    counts.posts += 1;
    const tab = CATEGORY_TO_TAB[category];
    if (tab && tab !== 'posts') counts[tab] += 1;
  }
  return counts;
}

/**
 * Parse a kind 30078 profile-tabs event into tab order + hidden set.
 * Unknown ids are dropped; known ids missing from the event are appended
 * visible in default order. Absent event → defaults.
 *
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {{ order: string[], hidden: string[] }}
 */
export function parseProfileTabsEvent(event) {
  if (!event?.tags) return { order: [...DEFAULT_TAB_ORDER], hidden: [] };

  /** @type {string[]} */
  const order = [];
  /** @type {string[]} */
  const hidden = [];
  const seen = new Set();

  for (const tag of event.tags) {
    if (tag[0] !== 'tab') continue;
    const id = tag[1];
    if (!KNOWN_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    if (tag[2] === 'hidden') hidden.push(id);
  }

  for (const id of DEFAULT_TAB_ORDER) {
    if (!seen.has(id)) order.push(id);
  }

  return { order, hidden };
}

/**
 * Build the tag list for a kind 30078 profile-tabs event.
 * @param {string[]} order - all tab ids in display order
 * @param {string[]} hidden - ids that are hidden
 * @returns {string[][]}
 */
export function buildProfileTabsTags(order, hidden) {
  const hiddenSet = new Set(hidden);
  return [
    ['d', PROFILE_TABS_D_TAG],
    ...order.map((id) => (hiddenSet.has(id) ? ['tab', id, 'hidden'] : ['tab', id]))
  ];
}
