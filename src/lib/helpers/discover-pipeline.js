/**
 * The discover page's content pipeline, as pure steps over `{type, data}`
 * items: raw items → relay filter → author filter → text search → sort.
 *
 * The page keeps one `$derived` per step so a changed search query does not
 * rebuild the raw items; each step here is pure (new arrays, inputs
 * untouched) and returns its input unchanged when it has nothing to do, so
 * downstream deriveds can short-circuit on identity.
 */
import { getArticlePublished } from 'applesauce-common/helpers';
import { getSeenRelays } from 'applesauce-core/helpers/relays';
import { normalizeURL } from 'applesauce-core/helpers';
import { matchesTextSearch } from '$lib/helpers/contentSearch.js';
import { mapCommunityItemsToRawItems } from '$lib/helpers/communityContent.js';

/**
 * @typedef {{ type: 'event' | 'amb' | 'article' | 'board', data: any }} RawItem
 * @typedef {'newest' | 'oldest' | 'relevance'} SortBy
 *
 * @typedef {object} RawSources
 * @property {any[]} calendarEvents
 * @property {any[]} ambResources
 * @property {any[]} articles
 * @property {any[]} kanbanBoards
 *
 * @typedef {object} RawItemOptions
 * @property {(type: string) => boolean} showsType - Whether the tab shows a discover content type
 * @property {(category: string, pubkey: string) => boolean} isAllowedAuthor - Curated/WoT gate per relay category
 * @property {Set<string> | null} [learningSearchIds] - Ids a NIP-50 learning search returned; set while a search is active
 * @property {Set<string>} [matchedAuthors] - Deployment members whose name the active search matches: their items pass every gate
 */

/** @type {Set<string>} */
const NO_AUTHORS = new Set();

/** Raw item `type` → discover content type (for the "all" tab gate). */
export const RAW_ITEM_CONTENT_TYPE = /** @type {Record<string, string>} */ ({
  event: 'events',
  amb: 'learning',
  article: 'articles',
  board: 'boards'
});

/**
 * The id a NIP-50 result refers to: formatted AMB resources wrap the event.
 * @param {any} resource
 */
const resourceEventId = (resource) => resource.event?.id || resource.id;

/**
 * Items from the global per-kind model arrays, gated by the curated/WoT set
 * of each relay category. While a learning search is active the NIP-50
 * result ids replace that gate for learning resources (the relay ranked
 * them; the curated set has nothing to add).
 *
 * @param {RawSources} sources
 * @param {RawItemOptions} options
 * @returns {RawItem[]}
 */
export function buildRawItems(
  sources,
  { showsType, isAllowedAuthor, learningSearchIds = null, matchedAuthors = NO_AUTHORS }
) {
  // Someone searched a member by name: the deployment vouches for its members
  // (they hold its NIP-05 handle), so their work is shown even where the
  // curated set or the relays' text ranking would leave it out.
  /** @param {string} category @param {string} pubkey */
  const allowed = (category, pubkey) =>
    matchedAuthors.has(pubkey) || isAllowedAuthor(category, pubkey);
  /** @type {RawItem[]} */
  const items = [];
  if (showsType('events')) {
    for (const e of sources.calendarEvents) {
      if (allowed('calendar', e.pubkey)) items.push({ type: 'event', data: e });
    }
  }
  if (showsType('learning')) {
    for (const r of sources.ambResources) {
      const ok = matchedAuthors.has(r.pubkey)
        ? true
        : learningSearchIds
          ? learningSearchIds.has(resourceEventId(r))
          : isAllowedAuthor('educational', r.pubkey);
      if (ok) items.push({ type: 'amb', data: r });
    }
  }
  if (showsType('articles')) {
    for (const a of sources.articles) {
      if (allowed('longform', a.pubkey)) items.push({ type: 'article', data: a });
    }
  }
  if (showsType('boards')) {
    for (const b of sources.kanbanBoards) {
      if (allowed('kanban', b.pubkey)) items.push({ type: 'board', data: b });
    }
  }
  return items;
}

/**
 * Items of one or more communities (CommunityActivityModel output). h-tag
 * membership is the curation, so no author gate; on the learning tab an
 * active search intersects the learning items with its result ids.
 *
 * @param {any[]} communityScopedItems
 * @param {string} contentType
 * @param {{ showsType: (type: string) => boolean, learningSearchIds?: Set<string> | null }} options
 * @returns {RawItem[]}
 */
export function buildCommunityRawItems(
  communityScopedItems,
  contentType,
  { showsType, learningSearchIds = null }
) {
  const items = /** @type {RawItem[]} */ (
    mapCommunityItemsToRawItems(
      communityScopedItems,
      /** @type {'all'|'events'|'learning'|'articles'|'boards'} */ (contentType)
    )
  ).filter((i) => showsType(RAW_ITEM_CONTENT_TYPE[i.type] || i.type));
  if (contentType === 'learning' && learningSearchIds && items.some((i) => i.type === 'amb')) {
    return items.filter((i) => i.type !== 'amb' || learningSearchIds.has(resourceEventId(i.data)));
  }
  return items;
}

/**
 * Items seen on `relayFilter` (relay provenance of the raw event).
 * @param {RawItem[]} items
 * @param {string | null} relayFilter
 */
export function filterByRelay(items, relayFilter) {
  if (!relayFilter) return items;
  const relay = normalizeURL(relayFilter);
  return items.filter((item) => {
    const event = item.data?.rawEvent || item.data?.originalEvent || item.data;
    return getSeenRelays(event)?.has(relay);
  });
}

/**
 * Items by the selected authors.
 * @param {RawItem[]} items
 * @param {string[]} authorFilter
 */
export function filterByAuthors(items, authorFilter) {
  if (authorFilter.length === 0) return items;
  const pubkeys = new Set(authorFilter);
  return items.filter((item) => pubkeys.has(item.data?.pubkey));
}

/**
 * Client-side text search. On the learning tab an active NIP-50 search owns
 * the query (its results are already relevance-ranked), and on the "all"
 * tab its learning items pass without a second match.
 *
 * @param {RawItem[]} items
 * @param {string} query
 * @param {{ profiles: Map<string, any>, contentType?: string, isLearningSearchActive?: boolean, matchedAuthors?: Set<string> }} options
 */
export function filterBySearch(
  items,
  query,
  { profiles, contentType = 'all', isLearningSearchActive = false, matchedAuthors = NO_AUTHORS }
) {
  if (!query.trim()) return items;
  if (contentType === 'learning' && isLearningSearchActive) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => {
    if (matchedAuthors.has(item.data?.pubkey)) return true;
    if (isLearningSearchActive && item.type === 'amb') return true;
    return matchesTextSearch(item, lower, profiles);
  });
}

/**
 * Search results by the deployment's people first: items of members whose
 * name the query matched, then items of other members, then everyone else.
 * Stable — the chosen sort holds inside each tier. Returns the input itself
 * when no item is by a member.
 * @param {RawItem[]} items
 * @param {{ matched: Set<string>, members: Set<string> }} authors
 * @returns {RawItem[]}
 */
export function tierByMembers(items, { matched, members }) {
  /** @type {RawItem[][]} */
  const tiers = [[], [], []];
  for (const item of items) {
    const pubkey = item.data?.pubkey;
    tiers[matched.has(pubkey) ? 0 : members.has(pubkey) ? 1 : 2].push(item);
  }
  if (tiers[2].length === items.length) return items;
  return tiers.flat();
}

/**
 * The sort the tab actually uses: events are soonest first; relevance only
 * exists while a learning search ranks the items.
 * @param {string} contentType
 * @param {string} sortBy
 * @param {boolean} canSortByRelevance
 * @returns {SortBy}
 */
export function resolveSortBy(contentType, sortBy, canSortByRelevance) {
  if (contentType === 'events') return 'oldest';
  if (sortBy === 'relevance' && !canSortByRelevance) return 'newest';
  return /** @type {SortBy} */ (sortBy);
}

/**
 * The timestamp an item sorts by.
 * @param {RawItem} item
 * @returns {number}
 */
export function getItemTimestamp(item) {
  switch (item.type) {
    case 'article':
      return getArticlePublished(item.data) || 0;
    case 'amb':
      return item.data.publishedDate || 0;
    case 'board':
      return item.data.created_at || 0;
    default:
      return item.data.start || 0;
  }
}

/**
 * Relevance key of a formatted AMB item — must match `searchRankKey(event)`.
 * @param {RawItem} item
 */
export function getItemRankKey(item) {
  const r = item.data;
  return r.identifier !== undefined ? `${r.kind}:${r.pubkey}:${r.identifier}` : r.id;
}

/**
 * A sorted copy: by rank (then newest) for relevance, else by timestamp.
 * @param {RawItem[]} items
 * @param {SortBy} sortBy
 * @param {Map<string, number>} [rank] - Relevance order by rank key
 */
export function sortItems(items, sortBy, rank = new Map()) {
  if (sortBy === 'relevance') {
    return [...items].sort((a, b) => {
      const aRank = rank.get(getItemRankKey(a)) ?? Infinity;
      const bRank = rank.get(getItemRankKey(b)) ?? Infinity;
      if (aRank !== bRank) return aRank - bRank;
      return getItemTimestamp(b) - getItemTimestamp(a);
    });
  }
  return [...items].sort((a, b) => {
    const aDate = getItemTimestamp(a);
    const bDate = getItemTimestamp(b);
    return sortBy === 'newest' ? bDate - aDate : aDate - bDate;
  });
}

/**
 * What the "My communities" filter should show while it has no communities to
 * scope to: the membership list is still loading, the user really has none,
 * or the list could not be loaded — three different messages, none of them
 * "no content matches your filters".
 *
 * @param {string | null} communityFilter
 * @param {number} joinedCount
 * @param {'loading' | 'ready' | 'unavailable'} status - From useJoinedCommunitiesState()
 * @returns {'loading' | 'empty' | 'unavailable' | null}
 */
export function joinedFilterState(communityFilter, joinedCount, status) {
  if (communityFilter !== 'joined' || joinedCount > 0) return null;
  if (status === 'loading') return 'loading';
  if (status === 'unavailable') return 'unavailable';
  return 'empty';
}
