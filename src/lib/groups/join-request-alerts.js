// Pure half of the admin join-request alert (issue 68669ba4) — the proactive
// "Beitrittsanfragen liegen vor" notice for NIP-29 admins, surfaced as a Termi
// hint. JoinRequestsPanel only helps an admin who already navigated to the
// members page; these helpers let a global hook answer the same question from
// the rosters the app already loads:
//
//   which of MY groups do I admin (39001 lists me)
//   → who is already on those rosters (members ∪ admins, per group)
//   → which community does a group id belong to (10222 membership/group tags)
//   → how many pending requests, grouped per community, for the hint copy
//     and its navigation target.
//
// The reactive wiring lives in ./join-request-alerts.svelte.js.
import { channelKey, parseGroupPointers } from './community-pointer.js';
import { parseMembershipPointer } from './community-membership.js';

/**
 * @typedef {{id: string, relay: string}} GroupPointer
 * @typedef {import('applesauce-common/helpers/groups').GroupAdmin} GroupAdmin
 */

/**
 * The subset of `pointers` whose 39001 admin list names `pubkey` — the groups
 * this user can moderate joins for (same actor rule as MembersView's
 * canModerateJoins, minus the key-holding-owner case, which the roster query
 * cannot see and which provisionRootGroup seats as a 39001 admin anyway).
 *
 * @param {{
 *   pointers: GroupPointer[],
 *   adminsByKey: Record<string, GroupAdmin[]>,
 *   pubkey: string
 * }} args
 * @returns {GroupPointer[]}
 */
export function adminGroupPointers({ pointers, adminsByKey, pubkey }) {
  if (!pubkey) return [];
  return (pointers ?? []).filter((pointer) => {
    const key = channelKey(pointer);
    if (!key) return false;
    return (adminsByKey?.[key] ?? []).some((admin) => admin.pubkey === pubkey);
  });
}

/**
 * Per-BARE-group-id rosters for pendingJoinRequests' already-a-member
 * exclusion: 39002 members ∪ 39001 admins (NIP-29 counts role holders as
 * members; some relays return 39001 without a 39002). A group with NO known
 * roster is omitted on purpose — pendingJoinRequests treats a missing entry
 * as "requester not a member", and overstating the alert beats silently
 * dropping a real request (same rule as the panel).
 *
 * @param {{
 *   pointers: GroupPointer[],
 *   membersByKey: Record<string, Set<string>>,
 *   adminsByKey: Record<string, GroupAdmin[]>
 * }} args
 * @returns {Map<string, Set<string>>}
 */
export function membersByGroupId({ pointers, membersByKey, adminsByKey }) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  for (const pointer of pointers ?? []) {
    const key = channelKey(pointer);
    if (!key) continue;
    const members = membersByKey?.[key];
    const admins = adminsByKey?.[key];
    if (!members && !admins) continue;
    map.set(pointer.id, new Set([...(members ?? []), ...(admins ?? []).map((a) => a.pubkey)]));
  }
  return map;
}

/**
 * Group id → community pubkey, from the communities' own 10222 events: the
 * root group via the `membership` pointer, every channel via its `group`
 * pointer — a 9021 can knock on either. First community wins on a conflict
 * (two 10222s claiming one group id is already out-of-spec).
 *
 * @param {any[]} communikeyEvents kind-10222 events
 * @returns {Map<string, string>}
 */
export function groupToCommunityMap(communikeyEvents) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const event of communikeyEvents ?? []) {
    const pubkey = event?.pubkey;
    if (typeof pubkey !== 'string' || !pubkey) continue;
    const membership = parseMembershipPointer(event);
    const ids = [
      ...(membership ? [membership.id] : []),
      ...parseGroupPointers(event).map((pointer) => pointer.id)
    ];
    for (const id of ids) {
      if (!map.has(id)) map.set(id, pubkey);
    }
  }
  return map;
}

/**
 * Shape the pending rows into what the hint renders: a total count and a
 * per-community breakdown (newest request first — the navigation target is
 * the first entry). Rows whose group maps to NO known community are dropped:
 * the hint's action must always lead somewhere actionable.
 *
 * @param {{
 *   pending: import('./join-requests.js').JoinRequestRow[],
 *   groupToCommunity: Map<string, string>
 * }} args
 * @returns {{count: number, communities: Array<{pubkey: string, count: number, newest: number}>}}
 */
export function summarizeJoinRequestAlert({ pending, groupToCommunity }) {
  /** @type {Map<string, {pubkey: string, count: number, newest: number}>} */
  const byCommunity = new Map();
  for (const row of pending ?? []) {
    const pubkey = groupToCommunity.get(row.groupId);
    if (!pubkey) continue;
    const entry = byCommunity.get(pubkey) ?? { pubkey, count: 0, newest: 0 };
    entry.count += 1;
    entry.newest = Math.max(entry.newest, row.createdAt);
    byCommunity.set(pubkey, entry);
  }
  const communities = [...byCommunity.values()].sort((a, b) => b.newest - a.newest);
  return { count: communities.reduce((sum, c) => sum + c.count, 0), communities };
}
