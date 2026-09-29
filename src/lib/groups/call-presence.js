// Kind 39004 — NIP-29 "livekit participants": an addressable event the
// relay publishes (and re-signs on every LiveKit join/leave webhook) listing
// who is live in a group's AV room. `d` = group id, one `participant` tag
// per hex pubkey. Clients only READ it — there is no client-side presence
// publishing in the NIP-29 AV model — and, exactly like kind 39000, it is
// only authoritative when signed by the relay's own NIP-11 key, hence the
// same `authors` pin channel-metadata-requests.js applies.
import { unique } from '$lib/helpers/unique.js';

export const CALL_PRESENCE_KIND = 39004;

/**
 * @param {string} groupId
 * @param {string[] | undefined} [authors] the relay's NIP-11 key(s); empty
 *   or omitted means the key is not known and the request goes out unpinned
 * @returns {{kinds: number[], '#d': string[], authors?: string[]}}
 */
export function callPresenceFilter(groupId, authors) {
  return authors && authors.length > 0
    ? { kinds: [CALL_PRESENCE_KIND], '#d': [groupId], authors }
    : { kinds: [CALL_PRESENCE_KIND], '#d': [groupId] };
}

/**
 * The pubkeys a 39004 says are in the room, lowercased, deduped and
 * validated — these feed keyed `{#each}` blocks and profile lookups.
 * @param {{kind?: unknown, tags?: unknown} | null | undefined} event
 * @returns {string[]}
 */
export function parseCallParticipants(event) {
  if (!event || event.kind !== CALL_PRESENCE_KIND || !Array.isArray(event.tags)) return [];
  /** @type {string[]} */
  const pubkeys = [];
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'participant') continue;
    const value = typeof tag[1] === 'string' ? tag[1].toLowerCase() : '';
    if (/^[0-9a-f]{64}$/.test(value)) pubkeys.push(value);
  }
  return unique(pubkeys);
}
