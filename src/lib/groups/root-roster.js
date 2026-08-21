// src/lib/groups/root-roster.js
//
// Pure projection of the batched roster records (channel-rosters.svelte.js)
// onto ONE root group — the community's membership engine per
// docs/nips/communikey-groups.md. Admins (39001) are unioned into members:
// NIP-29 counts users with privileged roles as members, and some relays
// return 39001 without a 39002.
import { channelKey } from './community-pointer.js';
import { isPublisher } from './roles.js';

/**
 * @typedef {import('applesauce-common/helpers/groups').GroupAdmin} GroupAdmin
 * @typedef {Object} RosterView
 * @property {Set<string>} members
 * @property {GroupAdmin[]} admins
 * @property {Set<string>} publishers - 39001 entries holding the publisher
 *   role, whether or not they also moderate. NIP-29 files every role holder
 *   under 39001, so this is the only way to tell a publisher from an admin.
 * @property {boolean} isLoading - true until at least one roster event arrived
 * @property {(pubkey: string) => boolean} isMember
 * @property {(pubkey: string) => string[]} rolesOf
 */

/**
 * @param {{id: string, relay: string} | null} pointer
 * @param {Record<string, Set<string>>} membersByKey
 * @param {Record<string, GroupAdmin[]>} adminsByKey
 * @param {Set<string>} [fetchedKeys] channelKeys whose relay fetch has ended.
 *   Roster records now come from the eventStore, which holds a Set only for a
 *   group it has actually seen a 39002 for — so `memberSet === undefined` means
 *   "not seen yet", which is still-loading UNLESS the relay has already
 *   answered (fetchedKeys), in which case it is a genuinely empty/inaccessible
 *   roster. Without fetchedKeys (pure callers, tests) the old
 *   "undefined = loading" rule holds.
 * @returns {RosterView}
 */
export function rosterView(pointer, membersByKey, adminsByKey, fetchedKeys) {
  const key = pointer ? channelKey(pointer) : null;
  const memberSet = key ? membersByKey[key] : undefined;
  const admins = (key && adminsByKey[key]) || [];

  const members = new Set(memberSet ?? []);
  for (const admin of admins) members.add(admin.pubkey);
  const hasAdmins = !!(key && adminsByKey[key]);
  const fetched = !!(key && fetchedKeys?.has(key));
  const isLoading = !!key && memberSet === undefined && !hasAdmins && !fetched;
  const publishers = new Set(
    admins.filter((admin) => isPublisher(admin.roles)).map((admin) => admin.pubkey)
  );
  return {
    members,
    admins,
    publishers,
    isLoading,
    isMember: (pubkey) => members.has(pubkey),
    rolesOf: (pubkey) => admins.find((admin) => admin.pubkey === pubkey)?.roles ?? []
  };
}
