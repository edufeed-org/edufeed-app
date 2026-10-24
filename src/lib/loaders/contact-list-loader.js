/**
 * Contact List Loader
 * Loads user's contact list (kind 3 event - NIP-02) using applesauce pattern
 */

import { createTimelineLoader } from '$lib/loaders/timeline-loader.js';

/**
 * Creates a loader for user's contact list (kind 3)
 * @param {import('applesauce-relay').RelayPool} pool - Relay pool instance
 * @param {string[]} defaultRelays - Array of relay URLs
 * @param {import('applesauce-core').EventStore} eventStore - EventStore instance
 * @param {string} userPubkey - User's public key
 * @returns {Function} Loader factory that returns an Observable
 */
export function createContactListLoader(pool, defaultRelays, eventStore, userPubkey) {
  return () =>
    createTimelineLoader(
      pool,
      defaultRelays,
      { kinds: [3], authors: [userPubkey], limit: 1 },
      { eventStore }
    );
}
