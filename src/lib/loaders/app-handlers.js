/**
 * NIP-89 handler discovery for an event kind the app has no view for.
 *
 * Two legs, following the NIP's user flow:
 *   1. Recommendations (kind 31989, `d` = kind) by the user and their follows
 *      → fetch the kind 31990 handler events their `a` tags name. These sort
 *      first: someone the user trusts vouched for the app.
 *   2. Direct `kinds:[31990], #k:[kind]` query for everything else, newest
 *      first. The NIP flags this as spam-prone, hence the dedicated relay
 *      list (APP_HANDLER_RELAYS) instead of the lookup/fallback relays.
 *
 * One-shot `pool.request` per leg; results feed the EventStore. Everything
 * degrades to "no handlers" — relay down, feature off, no follows.
 */
import { firstValueFrom, of } from 'rxjs';
import { catchError, tap, toArray } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAppHandlerRelays } from '$lib/helpers/relay-helper.js';
import {
  HANDLER_KIND,
  RECOMMENDATION_KIND,
  parseHandlerEvent,
  parseRecommendationAddresses
} from '$lib/helpers/nip89.js';

const REQUEST_TIMEOUT_MS = 5000;
/** Relays cap filter list sizes; kind-3 lists run into the thousands. */
const AUTHORS_BATCH = 250;
const DIRECT_LIMIT = 50;

/**
 * @typedef {import('$lib/helpers/nip89.js').AppHandler & { recommended: boolean }} DiscoveredHandler
 */

/**
 * @param {string[]} relays
 * @param {any} filter
 * @returns {Promise<any[]>}
 */
function request(relays, filter) {
  return firstValueFrom(
    pool.request(relays, filter, /** @type {any} */ ({ timeout: REQUEST_TIMEOUT_MS })).pipe(
      tap((event) => eventStore.add(event)),
      toArray(),
      catchError(() => of(/** @type {any[]} */ ([])))
    ),
    { defaultValue: /** @type {any[]} */ ([]) }
  );
}

/**
 * Addresses of handlers recommended for `kind` by any of `authors`.
 * @param {string[]} relays
 * @param {number} kind
 * @param {string[]} authors
 * @returns {Promise<Map<string, import('$lib/helpers/nip89.js').HandlerAddress>>}
 */
async function fetchRecommendedAddresses(relays, kind, authors) {
  /** @type {Promise<any[]>[]} */
  const batches = [];
  for (let i = 0; i < authors.length; i += AUTHORS_BATCH) {
    batches.push(
      request(relays, {
        kinds: [RECOMMENDATION_KIND],
        '#d': [String(kind)],
        authors: authors.slice(i, i + AUTHORS_BATCH)
      })
    );
  }
  const addresses = new Map();
  for (const events of await Promise.all(batches)) {
    for (const event of events) {
      for (const addr of parseRecommendationAddresses(event)) {
        // Platform-less and `web` recommendations are usable here; a handler
        // recommended for iOS only still gets found by the direct leg.
        if (addr.platform && addr.platform !== 'web') continue;
        addresses.set(addr.address, addr);
      }
    }
  }
  return addresses;
}

/**
 * Discover apps that can open events of `kind`.
 *
 * @param {number} kind
 * @param {{ authors?: string[] }} [options] - pubkeys whose kind 31989
 *   recommendations count (the user + their follows); empty skips that leg
 * @returns {Promise<DiscoveredHandler[]>} recommended first, then newest first
 */
export async function loadAppHandlers(kind, { authors = [] } = {}) {
  const relays = getAppHandlerRelays();
  if (relays.length === 0 || !Number.isInteger(kind)) return [];

  const recommended = authors.length
    ? await fetchRecommendedAddresses(relays, kind, authors)
    : new Map();

  /** @type {Promise<any[]>[]} */
  const legs = [
    request(relays, { kinds: [HANDLER_KIND], '#k': [String(kind)], limit: DIRECT_LIMIT })
  ];
  if (recommended.size > 0) {
    legs.push(
      request(relays, {
        kinds: [HANDLER_KIND],
        authors: [...new Set([...recommended.values()].map((a) => a.pubkey))],
        '#d': [...new Set([...recommended.values()].map((a) => a.identifier))]
      })
    );
  }

  /** @type {Map<string, DiscoveredHandler>} newest event per address */
  const byAddress = new Map();
  for (const events of await Promise.all(legs)) {
    for (const event of events) {
      const handler = parseHandlerEvent(event);
      if (!handler || !handler.kinds.includes(kind)) continue;
      const current = byAddress.get(handler.address);
      if (current && current.createdAt >= handler.createdAt) continue;
      byAddress.set(handler.address, { ...handler, recommended: recommended.has(handler.address) });
    }
  }

  return [...byAddress.values()].sort(
    (a, b) => Number(b.recommended) - Number(a.recommended) || b.createdAt - a.createdAt
  );
}
