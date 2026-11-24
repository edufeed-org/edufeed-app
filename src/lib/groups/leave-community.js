// Leaving a community's root group. Since pyramid edufeed-v1.26 the relay
// removes the person from every channel below the root as well
// (groups/cascade_removal.go), so their personal kind-10009 list must drop
// those channels too, or it keeps showing channels they have no seat in.
//
// Plain module (no runes), tested in node.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { lastValueFrom, toArray } from 'rxjs';
import { getPublicGroups } from 'applesauce-common/helpers/groups';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { leaveCommunity } from '$lib/helpers/community.js';
import { communityGroupsEndpoint, flatGroupsRelay } from './community-endpoint.js';
import { buildLeaveRequestTemplate } from './groups.js';
import { publishToGroupRelay } from './group-management.js';
import { parseMembershipPointer } from './community-membership.js';
import { parseGroupPointers } from './community-pointer.js';
import { updatePersonalGroupsList } from './personal-groups-list.js';

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

// The one "leave / unfollow this community" action (issue c379c8ff). A
// moderated community's membership is its root group's roster; the follow set
// (kind 30000) and my groups list (kind 10009) are my own notes about it.
// Unfollowing alone left me a member with every channel still readable and
// listed in other Nostr apps, so the community card and the settings page do
// what the channel menu's "Leave community" does: kind 9022 on the root group,
// root and channels out of my list, then the unfollow. A community without a
// root group has nothing to leave: plain unfollow.
/**
 * @param {string} communityPubkey
 * @param {{pubkey: string, signer: any} | null | undefined} user
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function leaveWholeCommunity(communityPubkey, user) {
  const communityEvent = eventStore.getReplaceable(10222, communityPubkey);
  const root = parseMembershipPointer(communityEvent);
  if (root && user?.signer) {
    // Looked up BEFORE leaving, as in the channel menu: afterwards the relay
    // hides a hidden channel's metadata. The community's own channel tags
    // cover a list this device has not loaded.
    const channels = parseGroupPointers(communityEvent);
    const mine = eventStore.getReplaceable(10009, user.pubkey);
    const below = await findListedChannelsBelow(root, mine ? getPublicGroups(mine) : []);
    let keepList = false;
    try {
      await publishToGroupRelay(pool.relay(root.relay), buildLeaveRequestTemplate(root.id), user);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The root group's creator cannot leave it (relay rule) and still owns
      // the channels: only the follow goes.
      keepList = /creator keeps/i.test(message);
      // Not on the roster is what the click wanted. Anything else means the
      // request did not arrive: unfollowing now would hide a community I am
      // still a member of.
      if (!keepList && !/unknown member/i.test(message)) {
        console.error('community leave request failed', err);
        return { success: false, error: message };
      }
    }
    if (!keepList) {
      // Not awaited: the list write first asks my relays (seconds on a dead
      // one), and the leave is already done.
      updatePersonalGroupsList(user, { remove: [root, ...channels, ...below] }).catch((err) =>
        console.error('groups: 10009 update failed', err)
      );
    }
  }
  return leaveCommunity(communityPubkey);
}
