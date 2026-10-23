/**
 * Blossom Server Loader - fetches kind 10063 events (NIP-B7)
 */
import { fetchEvents } from '$lib/loaders/base.js';

/**
 * A user's Blossom server list (kind 10063): one request to the lookup
 * relays, the newest copy into the EventStore.
 * @param {string[]} lookupRelays - Relays to search for server lists
 * @param {string} userPubkey - User's public key
 * @returns {import('rxjs').Observable<any>}
 */
export function createBlossomServerLoader(lookupRelays, userPubkey) {
  return fetchEvents(lookupRelays, { kinds: [10063], authors: [userPubkey], limit: 1 });
}
