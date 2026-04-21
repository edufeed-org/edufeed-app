/**
 * NIP-50 Search Loader for Educational Content (kind 30142)
 *
 * Uses the specialized AMB relay with Typesense backend for full-text search.
 * Uses pool.request() directly to ensure the NIP-50 search field is preserved.
 * Note: createTimelineLoader strips unknown filter fields during pagination,
 * so we bypass it for search queries.
 */
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getEducationalRelays } from '$lib/helpers/relay-helper.js';
import {
  buildSearchFilterObject,
  hasActiveFilters
} from '$lib/helpers/educational/searchQueryBuilder.js';

/**
 * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
 */

/**
 * Create a search loader for AMB resources using NIP-50 full-text search
 *
 * Returns an Observable that emits individual events as they arrive from relays.
 * Uses pool.request() directly to preserve the NIP-50 search field.
 *
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>} Observable that emits search results
 */
export function ambSearchLoader(filters, limit = 50) {
  // If no filters are active, return an empty observable that completes immediately
  if (!hasActiveFilters(filters)) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  // Build the NIP-50 search query + dual-emit #ext:... tag filters.
  // Tag filters act as a fallback for relays that don't yet parse ext.* paths.
  const { search: searchQuery, tagFilters } = buildSearchFilterObject(filters);

  if (!searchQuery && Object.keys(tagFilters).length === 0) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const relays = getEducationalRelays();
  /** @type {Record<string, any>} */
  const filter = { kinds: [30142], limit, ...tagFilters };
  if (searchQuery) filter.search = searchQuery;

  // Use pool.request() directly to preserve the search field
  // createTimelineLoader strips unknown filter fields during pagination
  return pool.request(relays, filter, /** @type {any} */ ({ timeout: 5000 })).pipe(
    tap((event) => eventStore.add(event)) // Add to eventStore for caching
  );
}

/**
 * Create a search loader for AMB resources within a community using NIP-50 full-text search.
 * Adds `#h` filter to scope results to a specific community.
 *
 * @param {string} communityPubkey - Community pubkey to scope search to
 * @param {SearchFilters} filters - The search filters
 * @param {number} limit - Maximum number of results
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function communityAMBSearchLoader(communityPubkey, filters, limit = 50) {
  if (!hasActiveFilters(filters)) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const { search: searchQuery, tagFilters } = buildSearchFilterObject(filters);

  if (!searchQuery && Object.keys(tagFilters).length === 0) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const relays = getEducationalRelays();
  /** @type {Record<string, any>} */
  const filter = { kinds: [30142], '#h': [communityPubkey], limit, ...tagFilters };
  if (searchQuery) filter.search = searchQuery;

  return pool
    .request(relays, filter, /** @type {any} */ ({ timeout: 5000 }))
    .pipe(tap((event) => eventStore.add(event)));
}

/**
 * Create a reactive search loader that can be called multiple times with updated filters
 * Returns a function that triggers a new search when called
 *
 * @param {number} limit - Maximum number of results per search
 * @returns {(filters: SearchFilters) => import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function createAMBSearchLoader(limit = 50) {
  return (filters) => ambSearchLoader(filters, limit);
}
