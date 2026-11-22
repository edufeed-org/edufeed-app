/**
 * NIP-50 Search Loader for Educational Content (kind 30142)
 *
 * Uses the specialized AMB relay with Typesense backend for full-text search.
 * Uses per-relay `pool.relay(url).request()` directly:
 * - a ranked search is one response per relay, not a feed window, and
 * - the pooled `pool.request()` merges and dedupes relays into one stream,
 *   which throws away each relay's relevance order. The AMB relay's scores
 *   are only meaningful within one response, so callers that want relevance
 *   ordering must merge by per-relay rank (see `searchRank.js`).
 */
import { Observable, merge } from 'rxjs';
import { catchError, distinct, map, tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import {
  buildSearchFilterObject,
  hasActiveFilters
} from '$lib/helpers/educational/searchQueryBuilder.js';

/**
 * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
 * @typedef {import('nostr-tools').Event} NostrEvent
 * @typedef {{ event: NostrEvent, relay: string, rank: number }} RankedSearchResult
 */

// A relay's whole budget, counted from the request and not from the open
// socket. A search opened as a link runs while the page starts up: the socket
// opens after 1-2 s and the answer queues behind megabytes of other traffic on
// the same connection (deletion events of the listed authors). Measured on
// dev, OERSI answered 8 s after the request started; with 5 s its hits were
// dropped and the page said nothing fits.
const REQUEST_TIMEOUT_MS = 12000;

/**
 * The relays a learning search is sent to: the deployment's learning-resource
 * relays. The fallback relays have no search for learning resources; one
 * never answers, so an empty search waited out the whole budget before it
 * could say that nothing was found. Without configured relays the fallback
 * relays are all there is.
 *
 * @returns {string[]}
 */
function searchRelays() {
  const appRelays = getAppRelaysForCategory('educational');
  return appRelays.length ? appRelays : getEducationalRelays();
}

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
 * @param {'only' | 'rest'} [fit] - Ask the relay for the hits that fit the question, or for the rest (see `ambRankedSearchLoader`)
 * @returns {Record<string, any> | null}
 */
function buildFilter(filters, limit, extra = {}, fit) {
  if (!hasActiveFilters(filters)) return null;

  // NIP-50 search query + dual-emit #ext:... tag filters.
  // Tag filters act as a fallback for relays that don't yet parse ext.* paths.
  const { search: searchQuery, tagFilters } = buildSearchFilterObject(filters);
  if (!searchQuery && Object.keys(tagFilters).length === 0) return null;

  /** @type {Record<string, any>} */
  const filter = { kinds: [30142], ...extra, limit, ...tagFilters };
  if (searchQuery) {
    // The relay judges a text search only; facets alone are a plain filter.
    filter.search = fit && filters.searchText?.trim() ? `${searchQuery} fit:${fit}` : searchQuery;
  }
  return filter;
}

/**
 * Query every search relay (`searchRelays`) separately and emit each result with the
 * relay it came from and its 1-based rank within that relay's response.
 * The same event may be emitted once per relay that returned it. A relay
 * that errors or times out ends only its own leg: the results it already
 * sent and every other relay's results stay. When every relay fails the
 * stream errors, so the caller can fall back (useLearningSearch filters the
 * loaded feed locally then).
 *
 * @param {Record<string, any> | null} filter
 * @returns {Observable<RankedSearchResult>}
 */
function rankedRequest(filter) {
  if (!filter) return empty();

  const relays = searchRelays();
  let failed = 0;
  return merge(
    ...relays.map((relay) => {
      let rank = 0;
      return pool
        .relay(relay)
        .request(filter, { timeout: REQUEST_TIMEOUT_MS })
        .pipe(
          tap((event) => eventStore.add(event)), // Add to eventStore for caching
          map((event) => ({ event, relay, rank: ++rank })),
          // One relay must not take the search down: a relay without NIP-50
          // closes the REQ with an error, a silent one times out. Only when
          // every relay failed does the search error, so the caller can fall back.
          catchError((error) => {
            if (++failed === relays.length) throw error;
            console.warn('🔍 learning search: relay failed', relay, error);
            return empty();
          })
        );
    })
  );
}

/**
 * Ranked NIP-50 search across all educational relays.
 *
 * `fit` uses the NOPE relays' NIP-50 extension: the relay tells hits that fit
 * the question from loosely related ones. `'only'` returns the fitting hits
 * (possibly none), `'rest'` the others, for a "less fitting" section. Without
 * it the relay returns both, fitting first. Wiki: edufeed-nip50-search.
 *
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results per relay
 * @param {'only' | 'rest'} [fit]
 * @returns {Observable<RankedSearchResult>}
 */
export function ambRankedSearchLoader(filters, limit = 50, fit) {
  return rankedRequest(buildFilter(filters, limit, {}, fit));
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
