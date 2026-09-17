/**
 * NIP-50 Search Loader for Educational Content (kind 30142)
 *
 * Uses the specialized AMB relay with Typesense backend for full-text search.
 * Uses per-relay `pool.relay(url).request()` directly:
 * - createTimelineLoader strips unknown filter fields (including `search`), and
 * - the pooled `pool.request()` merges and dedupes relays into one stream,
 *   which throws away each relay's relevance order. The AMB relay's scores
 *   are only meaningful within one response, so callers that want relevance
 *   ordering must merge by per-relay rank (see `searchRank.js`).
 */
import { Observable, merge } from 'rxjs';
import { distinct, map, tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import {
  buildSearchFilterObject,
  hasActiveFilters
} from '$lib/helpers/educational/searchQueryBuilder.js';

/**
 * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
 * @typedef {import('nostr-tools').Event} NostrEvent
 * @typedef {{ event: NostrEvent, relay: string, rank: number }} RankedSearchResult
 */

const REQUEST_TIMEOUT_MS = 5000;

/** @returns {Observable<never>} */
function empty() {
  return new Observable((subscriber) => subscriber.complete());
}

/**
 * Build the NIP-50 filter for the given search filters, or null when there
 * is nothing to search for.
 *
 * @param {SearchFilters} filters
 * @param {number} limit
 * @param {Record<string, any>} [extra] - Additional filter fields (e.g. `#h`)
 * @returns {Record<string, any> | null}
 */
function buildFilter(filters, limit, extra = {}) {
  if (!hasActiveFilters(filters)) return null;

  // NIP-50 search query + dual-emit #ext:... tag filters.
  // Tag filters act as a fallback for relays that don't yet parse ext.* paths.
  const { search: searchQuery, tagFilters } = buildSearchFilterObject(filters);
  if (!searchQuery && Object.keys(tagFilters).length === 0) return null;

  /** @type {Record<string, any>} */
  const filter = { kinds: [30142], ...extra, limit, ...tagFilters };
  if (searchQuery) filter.search = searchQuery;
  return filter;
}

/**
 * Query every educational relay separately and emit each result with the
 * relay it came from and its 1-based rank within that relay's response.
 * The same event may be emitted once per relay that returned it.
 *
 * @param {Record<string, any> | null} filter
 * @returns {Observable<RankedSearchResult>}
 */
function rankedRequest(filter) {
  if (!filter) return empty();

  const relays = getEducationalRelays();
  return merge(
    ...relays.map((relay) => {
      let rank = 0;
      return pool
        .relay(relay)
        .request(filter, { timeout: REQUEST_TIMEOUT_MS })
        .pipe(
          tap((event) => eventStore.add(event)), // Add to eventStore for caching
          map((event) => ({ event, relay, rank: ++rank }))
        );
    })
  );
}

/**
 * Ranked NIP-50 search across all educational relays.
 *
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results per relay
 * @returns {Observable<RankedSearchResult>}
 */
export function ambRankedSearchLoader(filters, limit = 50) {
  return rankedRequest(buildFilter(filters, limit));
}

/**
 * Plain NIP-50 search: emits events as they arrive from any relay,
 * deduplicated by id. Use `ambRankedSearchLoader` when the caller needs
 * relevance ordering.
 *
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results per relay
 * @returns {Observable<NostrEvent>} Observable that emits search results
 */
export function ambSearchLoader(filters, limit = 50) {
  return ambRankedSearchLoader(filters, limit).pipe(
    map((r) => r.event),
    distinct((event) => event.id)
  );
}

/**
 * NIP-50 search for AMB resources within a community.
 * Adds `#h` filter to scope results to a specific community.
 *
 * @param {string} communityPubkey - Community pubkey to scope search to
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results per relay
 * @returns {Observable<NostrEvent>}
 */
export function communityAMBSearchLoader(communityPubkey, filters, limit = 50) {
  return rankedRequest(buildFilter(filters, limit, { '#h': [communityPubkey] })).pipe(
    map((r) => r.event),
    distinct((event) => event.id)
  );
}

/**
 * Create a reactive search loader that can be called multiple times with updated filters
 * Returns a function that triggers a new search when called
 *
 * @param {number} limit - Maximum number of results per search
 * @returns {(filters: SearchFilters) => Observable<NostrEvent>}
 */
export function createAMBSearchLoader(limit = 50) {
  return (filters) => ambSearchLoader(filters, limit);
}
