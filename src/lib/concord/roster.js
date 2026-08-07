// Pure helpers for the community-wide member roster shown by
// ChannelMembersModal (Armada-parity follow-up: the modal used to list only
// authors observed writing in ONE channel — 2 people vs Armada's 85+roles —
// this splits the community's full membership into "leaders" (owner +
// anyone holding a live role, ordered by authority) and plain "members".
//
// IMPORTANT — this module only computes what the modal DISPLAYS. It must
// NEVER feed kickFromChannel/banFromChannel's `currentMembers` argument:
// those stay on the CHANNEL-scoped roster from moderation.js's
// channelMemberList (observed-in-channel ∪ self, minus banned). Widening the
// moderation keep-list to the community-wide roster would fan out a fresh
// channel key to every community member on the next rotation, not just the
// people who actually held it — see moderation.js's header comment for the
// full rotateChannel trail. No package imports here either — safe for
// node-env unit tests.
//
// Role ranking, verified against node_modules/applesauce-concord/dist
// (helpers/permissions.js, helpers/control.js): the owner is a fixed
// authority OUTSIDE the role list ("position 0 is the owner alone" —
// control.js skips any role edition that claims position <= 0); every real
// Role has position >= 1, and a LOWER position number is HIGHER authority
// (`resolveStanding`'s outrank check is `actor.position < target.position`).
// `community.roles$` is documented as "ordered by position (highest
// authority first)", i.e. ascending by position — this module re-derives
// that order itself from `position` rather than trusting caller order, so it
// degrades gracefully if a caller ever passes an unsorted list. A `deleted`
// role "confers no permissions or rank" per the dist's own doc comment, so
// deleted roles are excluded from ranking entirely — a member whose only
// grant is a deleted role falls through to the plain member list.

/**
 * @typedef {{role_id: string, name: string, position: number, deleted?: boolean}} RosterRole
 * @typedef {{pubkey: string, roleName: string|null, isOwner: boolean}} RosterLeader
 */

/**
 * Split a community's full membership into role-holding "leaders" (owner
 * first, then everyone else with a live role, highest authority first) and
 * plain "members" (no role). Dedupes the input member list.
 *
 * @param {{
 *   members: Set<string>|string[]|null|undefined,
 *   roles: RosterRole[]|null|undefined,
 *   grants: Map<string, string[]>|null|undefined,
 *   owner: string|null|undefined
 * }} args
 * @returns {{leaders: RosterLeader[], members: string[]}}
 */
export function memberSections({ members, roles, grants, owner }) {
  const memberList = [...new Set(members ?? [])].filter(Boolean);

  /** @type {Map<string, RosterRole>} */
  const roleById = new Map();
  for (const role of roles ?? []) {
    if (role?.role_id && !role.deleted) roleById.set(role.role_id, role);
  }
  const grantsMap = grants instanceof Map ? grants : new Map();

  /** @type {(RosterLeader & {position: number})[]} */
  const leaders = [];
  /** @type {string[]} */
  const plain = [];

  for (const pubkey of memberList) {
    if (owner && pubkey === owner) {
      leaders.push({ pubkey, roleName: null, isOwner: true, position: -1 });
      continue;
    }

    const roleIds = grantsMap.get(pubkey) ?? [];
    /** @type {RosterRole | undefined} */
    let best;
    for (const roleId of roleIds) {
      const role = roleById.get(roleId);
      if (role && (!best || role.position < best.position)) best = role;
    }

    if (best)
      leaders.push({ pubkey, roleName: best.name, isOwner: false, position: best.position });
    else plain.push(pubkey);
  }

  leaders.sort((a, b) => a.position - b.position);

  return {
    leaders: leaders.map(({ pubkey, roleName, isOwner }) => ({ pubkey, roleName, isOwner })),
    members: plain
  };
}
