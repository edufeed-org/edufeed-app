/**
 * Base loaders that bootstrap EventStore with relay knowledge.
 * These must be created before EventStore can intelligently fetch data.
 *
 * The loaders connect the EventStore to the relay pool, enabling automatic
 * data fetching without explicit configuration in each component.
 */
import {
  createAddressLoader,
  createEventLoader,
  createUnifiedEventLoader,
  createTimelineLoader
} from 'applesauce-loaders/loaders';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays, getEventLoaderLookupRelays } from '$lib/helpers/relay-helper.js';
import { cacheRequest } from '$lib/stores/event-cache.svelte.js';

/**
 * Pool wrapper for use with createTimelineLoader.
 *
 * The pool is configured with eoseTimeout: 3000 (in nostr-infrastructure.svelte.js),
 * so each relay emits a synthetic EOSE after 3s if unresponsive. This ensures
 * group.request() completes promptly and pagination can proceed.
 *
 * @param {string[]} relays
 * @param {import('nostr-tools').Filter[]} filters
 * @returns {import('rxjs').Observable<any>}
 */
export const timedPool = (relays, filters) => pool.request(relays, filters);

// Standalone address loader for direct use in components/loaders
// Uses a getter function for lookupRelays to ensure config updates are reflected.
// lookupRelays is applesauce's fallback-on-miss slot and must include profile
// indexer relays (e.g. purplepag.es) so kind 0 lookups can resolve when the
// author's profile isn't on the app content relays.
export const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  get lookupRelays() {
    return getEventLoaderLookupRelays();
  }
});

// Standalone event-by-ID loader for direct use
export const eventLoader = createEventLoader(pool, {
  eventStore,
  cacheRequest
});

// Unified loader for EventStore - handles both EventPointer and AddressPointer.
// Drives eventStore.profile() / eventStore.replaceable() auto-loading, so
// lookupRelays must include profile indexer relays (see addressLoader above).
const unifiedLoader = createUnifiedEventLoader(pool, {
  eventStore,
  cacheRequest,
  get lookupRelays() {
    return getEventLoaderLookupRelays();
  }
});
eventStore.eventLoader = unifiedLoader;

/**
 * Factory: Create a timeline loader for user's deletion events (NIP-09)
 * This is a general-purpose deletion loader that can be used for any deletable content.
 *
 * Fetches from all lookup relays (app relays + fallback) to ensure deletions are found
 * regardless of which relays the user published them to.
 *
 * @param {string} userPubkey - The pubkey of the user whose deletions to load
 * @returns {Function} Timeline loader function that returns an Observable
 *
 * @example
 * // Load a user's deletion events
 * const deletionLoader = userDeletionLoader(userPubkey);
 * deletionLoader().subscribe(deletionEvent => {
 *   // Process deletion event
 *   console.log('Deletion event:', deletionEvent);
 * });
 */
export const userDeletionLoader = (userPubkey) =>
  createTimelineLoader(
    timedPool,
    getAllLookupRelays(), // Use all lookup relays to find deletions published anywhere
    {
      kinds: [5], // NIP-09 deletion events
      authors: [userPubkey], // User's own deletions
      limit: 500 // Higher limit since deletions accumulate over time
    },
    { eventStore }
  );
