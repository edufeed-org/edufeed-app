/**
 * Relay List Loader - fetches kind 10002 events (NIP-65)
 * Following applesauce loader pattern
 */
import { createTimelineLoader } from '$lib/loaders/timeline-loader.js';

/**
 * Creates a loader for a user's relay list (kind 10002)
 * @param {import('applesauce-relay').RelayPool} pool - Relay pool instance
 * @param {string[]} lookupRelays - Relays to search for relay lists
 * @param {import('applesauce-core').EventStore} eventStore - EventStore instance
 * @param {string} userPubkey - User's public key
 * @returns {Function} Loader factory that returns an Observable
 */
export function createRelayListLoader(pool, lookupRelays, eventStore, userPubkey) {
  return () =>
    createTimelineLoader(
      pool,
      lookupRelays,
      { kinds: [10002], authors: [userPubkey], limit: 1 },
      { eventStore }
    );
}
