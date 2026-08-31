// Which kind:39000 to ask for, and where.
//
// A community's channels can sit on different relays, and a relay-authored
// addressable is only authoritative on the relay that wrote it — so metadata
// is requested per relay, from that relay alone (the same rule GroupChat
// already follows for a single group).
//
// One request per RELAY, not per channel: a community with eight channels on
// our relay opens one subscription, not eight.
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { channelKey } from './community-pointer.js';

/**
 * @typedef {{
 *   relay: string,
 *   filter: {kinds: number[], '#d': string[]},
 *   keys: string[]
 * }} MetadataRequest
 */

/**
 * @param {Array<{id: string, relay: string}> | null | undefined} pointers
 * @returns {MetadataRequest[]}
 */
export function metadataRequestsByRelay(pointers) {
  if (!Array.isArray(pointers)) return [];

  /** @type {Map<string, {ids: string[], keys: string[], seen: Set<string>}>} */
  const byRelay = new Map();

  for (const pointer of pointers) {
    const key = channelKey(pointer);
    if (!key) continue; // unaddressable — nothing to ask for
    const relay = normalizeURL(pointer.relay);
    let entry = byRelay.get(relay);
    if (!entry) {
      entry = { ids: [], keys: [], seen: new Set() };
      byRelay.set(relay, entry);
    }
    if (entry.seen.has(key)) continue; // the same channel listed twice
    entry.seen.add(key);
    entry.ids.push(pointer.id);
    // The row builder looks metadata up by channelKey, so carry those keys
    // back with the request — otherwise every row stays "pending" forever.
    entry.keys.push(key);
  }

  return [...byRelay.entries()].map(([relay, { ids, keys }]) => ({
    relay,
    filter: { kinds: [GROUP_METADATA_KIND], '#d': ids },
    keys
  }));
}
