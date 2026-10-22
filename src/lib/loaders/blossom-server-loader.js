/**
 * Blossom Server Loader - fetches kind 10063 events (NIP-B7)
 * Following applesauce loader pattern
 */
import { createTimelineLoader } from '$lib/loaders/timeline-loader.js';

/**
 * Creates a loader for a user's Blossom server list (kind 10063)
 * @param {import('applesauce-relay').RelayPool} pool - Relay pool instance
 * @param {string[]} lookupRelays - Relays to search for server lists
 * @param {import('applesauce-core').EventStore} eventStore - EventStore instance
 * @param {string} userPubkey - User's public key
 * @returns {Function} Loader factory that returns an Observable
 */
export function createBlossomServerLoader(pool, lookupRelays, eventStore, userPubkey) {
  return () =>
    createTimelineLoader(
      pool,
      lookupRelays,
      { kinds: [10063], authors: [userPubkey], limit: 1 },
      { eventStore }
    );
}
