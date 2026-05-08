/**
 * NIP-50 Search Loader for Calendar Events (kinds 31922, 31923)
 *
 * Uses pool.request() directly so the NIP-50 `search` filter field survives —
 * createTimelineLoader strips unknown filter fields during pagination.
 *
 * Falls silently empty for queries shorter than MIN_QUERY_LENGTH so callers
 * can wire it directly to a debounced input without guarding the call site.
 */
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';

/** Minimum length (after trim) before a query is sent to relays. */
export const MIN_QUERY_LENGTH = 2;

/**
 * @typedef {Object} CalendarSearchOptions
 * @property {number} [limit] Maximum events per relay (default 50).
 * @property {string[]} [relays] Override the calendar relay list.
 * @property {number} [timeout] Per-request timeout in ms (default 5000).
 */

/**
 * Run a NIP-50 full-text search against calendar relays.
 *
 * @param {string} query
 * @param {CalendarSearchOptions} [options]
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function calendarSearchLoader(query, options = {}) {
  const trimmed = (query ?? '').trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return new Observable((subscriber) => subscriber.complete());
  }

  const { limit = 50, relays, timeout = 5000 } = options;
  const targetRelays = relays && relays.length > 0 ? relays : getCalendarRelays();

  /** @type {Record<string, any>} */
  const filter = { kinds: [31922, 31923], search: trimmed, limit };

  return pool
    .request(targetRelays, filter, /** @type {any} */ ({ timeout }))
    .pipe(tap((event) => eventStore.add(event)));
}
