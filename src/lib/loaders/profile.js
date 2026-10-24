/**
 * Profile loading utilities for user profiles and notes.
 */
import { createAddressLoader } from 'applesauce-loaders/loaders';
import { createTimelineLoader } from '$lib/loaders/timeline-loader.js';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
import { getProfileContent } from 'applesauce-core/helpers';
import { take, map } from 'rxjs';

// Profile loader with purplepag.es relay for enhanced profile discovery
export const profileLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ['wss://purplepag.es/']
});

/**
 * Load user profile with RxJS operators
 * @param {number} kind - Event kind (typically 0 for profiles)
 * @param {string} pubkey - User's public key
 * @returns {import('rxjs').Observable<any>} Observable that emits the profile content
 */
export function loadUserProfile(kind, pubkey) {
  return profileLoader({ kind, pubkey, relays: getProfileLookupRelays() }).pipe(
    // Take only the first (most recent) profile
    take(1),
    map((event) => getProfileContent(event))
  );
}

/**
 * Factory: Create a timeline loader for kind 1 notes by a specific user
 * @param {string} pubkey - User's public key
 * @param {number} limit - Maximum number of notes to load
 * @returns {Function} Timeline loader function that returns an Observable
 */
export function kind1Loader(pubkey, limit) {
  return createTimelineLoader(
    pool,
    getProfileLookupRelays(),
    {
      kinds: [1],
      authors: [pubkey],
      limit
    },
    { eventStore }
  );
}
