// Leaving a community's root group. Since pyramid edufeed-v1.26 the relay
// removes the person from every channel below the root as well
// (groups/cascade_removal.go), so their personal kind-10009 list must drop
// those channels too, or it keeps showing channels they have no seat in.
//
// Plain module (no runes), tested in node.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { lastValueFrom, toArray } from 'rxjs';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { communityGroupsEndpoint, flatGroupsRelay } from './community-endpoint.js';

// One spelling per relay address: lower-case host, no trailing slash (a list
// written by another client may carry either form).
/** @param {string} url */
const same = (url) => normalizeURL(url).replace(/\/+$/, '');

/**
 * The entries of my list that are channels of this community: listed under
 * the community's own endpoint (`…/c/<rootId>`), or listed under the flat
 * host with a kind-39000 whose `parent` is the root. The root itself is not
 * included.
 *
 * @param {{id: string, relay: string}} root the community's root group
 * @param {Array<{id: string, relay: string}>} listed my kind-10009 entries
 * @param {Array<{tags?: string[][]}>} metadata kind-39000 events of the flat-listed entries
 * @returns {Array<{id: string, relay: string}>}
 */
export function listedChannelsBelow(root, listed, metadata) {
  const flat = flatGroupsRelay(root.relay);
  const endpoint = same(communityGroupsEndpoint(flat, root.id));
  const flatUrl = same(flat);
  const childIds = new Set(
    metadata
      .filter((e) => (e.tags ?? []).some((t) => t[0] === 'parent' && t[1] === root.id))
      .map((e) => (e.tags ?? []).find((t) => t[0] === 'd')?.[1])
  );
  return listed.filter((entry) => {
    if (entry.id === root.id) return false;
    const relay = same(entry.relay);
    return relay === endpoint || (relay === flatUrl && childIds.has(entry.id));
  });
}

/**
 * `listedChannelsBelow` with the metadata fetched from the relay. Never
 * throws: when the relay does not answer, only the entries addressed through
 * the community's endpoint are found.
 *
 * @param {{id: string, relay: string}} root
 * @param {Array<{id: string, relay: string}>} listed
 * @returns {Promise<Array<{id: string, relay: string}>>}
 */
export async function findListedChannelsBelow(root, listed) {
  const flat = normalizeURL(flatGroupsRelay(root.relay));
  const ids = listed
    .filter((e) => same(e.relay) === same(flat) && e.id !== root.id)
    .map((e) => e.id);
  /** @type {any[]} */
  let metadata = [];
  if (ids.length > 0) {
    try {
      metadata = await lastValueFrom(
        pool
          .relay(flat)
          .request({ kinds: [39000], '#d': ids }, { timeout: 4000 })
          .pipe(toArray()),
        { defaultValue: [] }
      );
    } catch {
      metadata = [];
    }
  }
  return listedChannelsBelow(root, listed, metadata);
}
