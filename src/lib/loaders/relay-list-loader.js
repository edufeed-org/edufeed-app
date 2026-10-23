/**
 * Relay List Loader - fetches kind 10002 events (NIP-65)
 */
import { fetchEvents } from '$lib/loaders/base.js';

/**
 * A user's relay list (kind 10002): one request to the lookup relays, the
 * newest copy into the EventStore.
 * @param {string[]} lookupRelays - Relays to search for relay lists
 * @param {string} userPubkey - User's public key
 * @returns {import('rxjs').Observable<any>}
 */
export function createRelayListLoader(lookupRelays, userPubkey) {
  return fetchEvents(lookupRelays, { kinds: [10002], authors: [userPubkey], limit: 1 });
}
