/**
 * Contact List Loader
 * Loads user's contact list (kind 3 event - NIP-02)
 */
import { fetchEvents } from '$lib/loaders/base.js';

/**
 * A user's contact list (kind 3): one request, the newest copy into the
 * EventStore.
 * @param {string[]} defaultRelays - Array of relay URLs
 * @param {string} userPubkey - User's public key
 * @returns {import('rxjs').Observable<any>}
 */
export function createContactListLoader(defaultRelays, userPubkey) {
  return fetchEvents(defaultRelays, { kinds: [3], authors: [userPubkey], limit: 1 });
}
