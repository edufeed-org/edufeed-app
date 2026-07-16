/**
 * Relay Selection Service - NIP-65 implementation
 * Manages relay list fetching, caching, and selection for outbox model
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { RelayListModel } from '$lib/models/relay-list-model.js';
import { addressLoader } from '$lib/loaders/base.js';

/**
 * Get relay list lookup relays from runtime config
 * @returns {string[]}
 */
function getLookupRelays() {
  return runtimeConfig.relayListLookupRelays || [];
}

/**
 * Get default/fallback relays from runtime config
 * Used for users without kind 10002 relay list
 * @returns {string[]}
 */
function getDefaultRelays() {
  return runtimeConfig.fallbackRelays || [];
}

// Cache for relay lists (pubkey -> { writeRelays, readRelays, fetchedAt })
/** @type {SvelteMap<string, {writeRelays: string[], readRelays: string[], fetchedAt: number}>} */
const relayListCache = new SvelteMap();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Hard cap for the kind 10002 lookup. With completion-aware resolution the
// healthy paths settle at model-emission (instant when cached/prefetched) or
// loader EOSE (confirmed absence) — this cap only bites when lookup relays
// hang, and it is logged because the caller will silently fall back to
// fallbackRelays, misrouting the publish (2026-07-16 incident).
const FETCH_RELAY_LIST_TIMEOUT = 8_000;

/**
 * Fetch relay list for a pubkey (with caching).
 *
 * Resolution order: cached entry → model emission (kind 10002 already in or
 * arriving into EventStore) → loader completion with nothing found (confirmed
 * absence, resolves null fast) → hard timeout (resolves null, warns).
 *
 * @param {string} pubkey - User's public key
 * @returns {Promise<{writeRelays: string[], readRelays: string[]} | null>}
 */
export async function fetchRelayList(pubkey) {
  // Check cache
  const cached = relayListCache.get(pubkey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached;
  }

  // Fetch from relays
  return new Promise((resolve) => {
    let resolved = false;
    /** @type {import('rxjs').Subscription | undefined} */
    let subscription;
    /** @type {import('rxjs').Subscription | undefined} */
    let loaderSub;
    /** @type {{writeRelays: string[], readRelays: string[]} | null} */
    let latest = null;

    /** @param {{writeRelays: string[], readRelays: string[]} | null} relayList */
    const settle = (relayList) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      // Defer teardown: settle() can fire synchronously inside subscribe(),
      // before the subscription variables are assigned.
      queueMicrotask(() => {
        subscription?.unsubscribe();
        loaderSub?.unsubscribe();
      });
      if (relayList) {
        /** @type {any} */
        const cacheEntry = { ...relayList, fetchedAt: Date.now() };
        relayListCache.set(pubkey, cacheEntry);
        resolve(cacheEntry);
      } else {
        resolve(null);
      }
    };

    const timeout = setTimeout(() => {
      console.warn(
        `[relay-service] kind 10002 lookup timed out for ${pubkey.slice(0, 8)}… — ` +
          'callers will fall back to default relays'
      );
      settle(latest);
    }, FETCH_RELAY_LIST_TIMEOUT);

    // Emits synchronously when the 10002 is already in EventStore (IDB
    // warm-up or login prefetch) — the common fast path.
    // @ts-ignore - applesauce model type mismatch
    subscription = eventStore.model(RelayListModel, pubkey).subscribe(
      (
        // @ts-ignore - parameter type narrowing on applesauce model callback
        /** @type {{writeRelays: string[], readRelays: string[]} | undefined} */ relayList
      ) => {
        if (relayList) {
          latest = relayList;
          settle(relayList);
        }
      }
    );

    // Loader completion = lookup relays EOSEd. If the model produced nothing
    // by then, the pubkey has no kind 10002 (the legit new-user case) —
    // resolve fast instead of burning the timeout.
    // addressLoader (unlike a timeline loader) completes after its
    // cache→relays→lookup sequence — measured ~1.3s for a confirmed miss —
    // and dedupes concurrent requests for the same pointer.
    loaderSub = addressLoader({ kind: 10002, pubkey, relays: getLookupRelays() }).subscribe({
      complete: () => settle(latest),
      error: () => settle(latest)
    });
  });
}

/**
 * Get write relays for a user (used when downloading events FROM that user)
 * Falls back to defaultRelays if no relay list found
 * @param {string} pubkey - User's public key
 * @returns {Promise<string[]>}
 */
export async function getWriteRelays(pubkey) {
  const relayList = await fetchRelayList(pubkey);
  if (relayList && relayList.writeRelays.length > 0) {
    return relayList.writeRelays;
  }
  return getDefaultRelays();
}

/**
 * Get read relays for a user (used when publishing events ABOUT that user)
 * Falls back to defaultRelays if no relay list found
 * @param {string} pubkey - User's public key
 * @returns {Promise<string[]>}
 */
export async function getReadRelays(pubkey) {
  const relayList = await fetchRelayList(pubkey);
  if (relayList && relayList.readRelays.length > 0) {
    return relayList.readRelays;
  }
  return getDefaultRelays();
}

/**
 * Get primary write relay for a user (for relay hints in tags)
 * @param {string} pubkey - User's public key
 * @returns {Promise<string>}
 */
export async function getPrimaryWriteRelay(pubkey) {
  const relayList = await fetchRelayList(pubkey);
  if (relayList && relayList.writeRelays.length > 0) {
    return relayList.writeRelays[0];
  }
  return getDefaultRelays()[0];
}

/**
 * Calculate publish relays for outbox model
 * Sends to: author's write relays + all tagged users' read relays
 * @param {string} authorPubkey - Event author's public key
 * @param {string[]} taggedPubkeys - Array of pubkeys tagged in the event
 * @returns {Promise<string[]>}
 */
export async function getPublishRelays(authorPubkey, taggedPubkeys = []) {
  const relaySet = new SvelteSet();

  // Add author's write relays
  const authorRelays = await getWriteRelays(authorPubkey);
  authorRelays.forEach((r) => relaySet.add(r));

  // Add each tagged user's read relays (limit to 2 per user to avoid too many)
  if (taggedPubkeys.length > 0) {
    await Promise.all(
      taggedPubkeys.map(async (pubkey) => {
        const readRelays = await getReadRelays(pubkey);
        readRelays.slice(0, 2).forEach((r) => relaySet.add(r));
      })
    );
  }

  return Array.from(relaySet);
}

/**
 * Clear cache (for testing or forced refresh)
 */
export function clearRelayListCache() {
  relayListCache.clear();
}

/**
 * Invalidate cache for a specific pubkey (after saving new relay list)
 * @param {string} pubkey - User's public key
 */
export function invalidateRelayListCache(pubkey) {
  relayListCache.delete(pubkey);
}

/**
 * Get relay list lookup relays (for infrastructure)
 * @returns {string[]}
 */
export function getRelayListLookupRelays() {
  return getLookupRelays();
}
