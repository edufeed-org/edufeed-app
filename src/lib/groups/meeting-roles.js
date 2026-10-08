// Co-host roles on a scheduled meeting (NIP-52 kind 31923): the `p`-tag role
// slot (`["p", <pubkey>, <relay>, <role>]`) names who hosts the channel's call
// beside the meeting's author. The group relay (pyramid, groups/call_host.go)
// reads the same set, so a role written here is the role the seat joins
// with. Plain module (no runes), shared by the meeting editor and tests.

/**
 * The explicit role the editor's "Co-Host" toggle writes. The calendar's
 * own `moderator` and `organizer` presets count as co-host too (laoc,
 * 2026-10-07: reuse the NIP-52 roles rather than invent a new one).
 */
export const COHOST_ROLE = 'co-host';

/** @type {ReadonlySet<string>} */
export const COHOST_ROLES = new Set([COHOST_ROLE, 'cohost', 'moderator', 'organizer']);

/**
 * @param {string | undefined | null} role
 * @returns {boolean}
 */
export function isCohostRole(role) {
  return typeof role === 'string' && COHOST_ROLES.has(role.trim().toLowerCase());
}

/**
 * The participant with the co-host role set or cleared. Clearing drops
 * the role entirely (a plain seat); a `moderator`/`organizer` preset is
 * dropped too, since it would keep the seat a co-host.
 * @template {{role?: string}} P
 * @param {P} participant
 * @param {boolean} on
 * @returns {P}
 */
export function withCohostRole(participant, on) {
  if (on) return { ...participant, role: COHOST_ROLE };
  const { role: _role, ...rest } = participant;
  return /** @type {P} */ (rest);
}

/**
 * The pubkeys a meeting event names as co-hosts (its author excluded).
 * @param {{pubkey?: string, tags?: string[][]} | null | undefined} event
 * @returns {string[]}
 */
export function meetingCohosts(event) {
  const out = new Set();
  for (const tag of event?.tags ?? []) {
    if (!Array.isArray(tag) || tag[0] !== 'p' || !isCohostRole(tag[3])) continue;
    if (typeof tag[1] !== 'string' || !/^[0-9a-f]{64}$/i.test(tag[1])) continue;
    const pk = tag[1].toLowerCase();
    if (pk !== event?.pubkey) out.add(pk);
  }
  return [...out];
}
