/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  stufe2Pointers,
  communityMembershipPointers,
  areaMemberRows,
  fanOutPlan,
  aggregateFanOut,
  reconcilePlan,
  demotePlan
} from '$lib/groups/area-members.js';
import { channelKey } from '$lib/groups/community-pointer.js';

const R = 'wss://groups.example';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const community = {
  kind: 10222,
  tags: [
    ['group', 'g1', R, 'Allgemein', 'members'],
    ['group', 'g2', R, 'Planung', 'members'],
    ['group', 'g3', R, 'Vorstand', 'invited']
  ]
};
const [p1, p2] = stufe2Pointers(community);
const k1 = /** @type {string} */ (channelKey(p1));
const k2 = /** @type {string} */ (channelKey(p2));

describe('stufe2Pointers', () => {
  it('keeps only access=members pointers', () => {
    expect(stufe2Pointers(community).map((p) => p.id)).toEqual(['g1', 'g2']);
  });
});

describe('communityMembershipPointers', () => {
  it('prepends the root membership group to the members channels (invited excluded)', () => {
    const withRoot = {
      kind: 10222,
      tags: [['membership', 'root0', R], ...community.tags]
    };
    const ptrs = communityMembershipPointers(withRoot);
    expect(ptrs.map((p) => p.id)).toEqual(['root0', 'g1', 'g2']);
    expect(ptrs[0]).toMatchObject({ id: 'root0', relay: R }); // root first
  });

  it('is just the members channels when there is no membership pointer', () => {
    expect(communityMembershipPointers(community).map((p) => p.id)).toEqual(['g1', 'g2']);
  });
});

describe('areaMemberRows', () => {
  it('unions members and names where each is missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], memberKeys: [k1, k2], adminOnlyKeys: [], missingKeys: [] },
      { pubkey: B, inKeys: [k1], memberKeys: [k1], adminOnlyKeys: [], missingKeys: [k2] }
    ]);
  });
  it('treats an unloaded roster as unknown, not missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A]) }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1], memberKeys: [k1], adminOnlyKeys: [], missingKeys: [] }
    ]);
  });

  // Handoff #11d: NIP-29 counts privileged roles as members (root-roster.js
  // follows the same rule for the ROOT group) — an admin who never got an
  // explicit 39002 entry in one of their own channels is not "missing"
  // there, just implicit. Passing adminsByKey lets area-members read that
  // the same way, so neither the badge nor a sync/repair fan-out treats
  // them as a deviation. `inKeys` (display/gating) still unions the two,
  // but `memberKeys`/`adminOnlyKeys` keep the distinction a REMOVAL fan-out
  // needs (review follow-up): kind-9001 remove-user is a no-op for a
  // pubkey with no 39002 entry.
  it('an admin without an explicit 39002 entry counts as present via adminOnlyKeys, not missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) },
      adminsByKey: { [k2]: [{ pubkey: B, roles: ['admin'] }] }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], memberKeys: [k1, k2], adminOnlyKeys: [], missingKeys: [] },
      { pubkey: B, inKeys: [k1, k2], memberKeys: [k1], adminOnlyKeys: [k2], missingKeys: [] }
    ]);
  });

  // Symmetric case: an admin-only presence (no 39002 entry ANYWHERE) still
  // surfaces as a row rather than being invisible to the area view.
  it('an admin with no 39002 entry anywhere still becomes a row, fully present via adminOnlyKeys', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A]), [k2]: new Set([A]) },
      adminsByKey: { [k1]: [{ pubkey: B, roles: ['admin'] }] }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], memberKeys: [k1, k2], adminOnlyKeys: [], missingKeys: [] },
      { pubkey: B, inKeys: [k1], memberKeys: [], adminOnlyKeys: [k1], missingKeys: [k2] }
    ]);
  });
});

describe('fanOutPlan', () => {
  it('targets only channels the pubkey is missing from', () => {
    const plan = fanOutPlan({
      pubkey: B,
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) }
    });
    expect(plan.map((p) => p.id)).toEqual(['g2']);
  });

  // Handoff #11d: an admin-implicit presence must not become a spurious
  // put-user fan-out target — they are already effectively a member of a
  // channel they administer.
  it('does not target a channel where the pubkey is already an admin', () => {
    const plan = fanOutPlan({
      pubkey: B,
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) },
      adminsByKey: { [k2]: [{ pubkey: B, roles: ['admin'] }] }
    });
    expect(plan).toEqual([]);
  });
});

describe('aggregateFanOut', () => {
  it('splits ok from failed', () => {
    expect(
      aggregateFanOut([
        { key: k1, ok: true },
        { key: k2, ok: false }
      ])
    ).toEqual({ ok: [k1], failed: [k2] });
  });
});

describe('reconcilePlan', () => {
  const RELAY = 'wss://groups.example/';
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const chan1 = { id: 'chan1', relay: RELAY };
  const chan2 = { id: 'chan2', relay: RELAY };
  const k = (/** @type {any} */ p) => /** @type {string} */ (channelKey(p));

  // Root-group admins granted AFTER a channel was created (ChannelCreateWizard
  // only pre-joins admins at CREATION time — A3) are missing from that
  // channel's roster — the plan is every (channel, admin) pair an admin
  // needs to put-user (laoc, 2026-08-19).
  it('pairs every root admin missing from an answered channel roster', () => {
    const plan = reconcilePlan({
      admins: [A, B],
      pointers: [chan1, chan2],
      membersByKey: { [k(chan1)]: new Set([A]), [k(chan2)]: new Set() },
      adminsByKey: {}
    });
    expect(plan).toEqual([
      { pointer: chan1, pubkey: B },
      { pointer: chan2, pubkey: A },
      { pointer: chan2, pubkey: B }
    ]);
  });

  it('never plans against a roster that has not answered ("no answer" is not "not a member")', () => {
    const plan = reconcilePlan({
      admins: [A],
      pointers: [chan1],
      membersByKey: {},
      adminsByKey: {}
    });
    expect(plan).toEqual([]);
  });

  it('counts channel admins as present', () => {
    const plan = reconcilePlan({
      admins: [A],
      pointers: [chan1],
      membersByKey: { [k(chan1)]: new Set() },
      adminsByKey: { [k(chan1)]: [{ pubkey: A, roles: ['admin'] }] }
    });
    expect(plan).toEqual([]);
  });

  // A4: retired the members-tier blanket fan-out — members now join
  // member-tier channels themselves via their own 9021. reconcilePlan's
  // input switches from the root roster's MEMBERS to its ADMINS, and it now
  // plans over ALL channel pointers (any tier), not just members-tier ones,
  // since admins belong everywhere.
  it('reconcilePlan targets admins missing from ANY answered channel, with no member sweep', () => {
    const chMembers = { id: 'chan-members', relay: RELAY };
    const chInvited = { id: 'chan-invited', relay: RELAY };
    const key = (/** @type {any} */ p) => /** @type {string} */ (channelKey(p));
    const plan = reconcilePlan({
      admins: [A],
      pointers: [chMembers, chInvited], // both answered below
      membersByKey: { [key(chMembers)]: new Set(), [key(chInvited)]: new Set([A]) },
      adminsByKey: { [key(chMembers)]: [], [key(chInvited)]: [] }
    });
    expect(plan).toEqual([{ pointer: chMembers, pubkey: A }]);
  });
});

// Cleanup for the publisher→admin escalation bug: both fan-out paths used to
// put-user EVERY root-39001 entry with role ['admin'] on channels, handing
// publisher-only members literal NIP-29 moderation rights there. demotePlan
// computes the revert — a re-put-user with the moderation roles stripped —
// strictly for entries the bug can explain: publisher-only on the ROOT
// roster yet holding a moderation role on a channel.
describe('demotePlan', () => {
  const RELAY = 'wss://groups.example/';
  const ADMIN = 'a'.repeat(64);
  const PUB = 'b'.repeat(64);
  const STRANGER = 'c'.repeat(64);
  const chan = { id: 'chan1', relay: RELAY };
  const key = /** @type {string} */ (channelKey(chan));
  const rootAdmins = [
    { pubkey: ADMIN, roles: ['admin'] },
    { pubkey: PUB, roles: ['publisher'] }
  ];

  it('demotes a publisher-only root entry that holds admin on a channel', () => {
    const plan = demotePlan({
      rootAdmins,
      pointers: [chan],
      adminsByKey: { [key]: [{ pubkey: PUB, roles: ['admin'] }] }
    });
    expect(plan).toEqual([{ pointer: chan, pubkey: PUB, roles: [] }]);
  });

  it('strips only moderation roles, preserving other channel roles', () => {
    const plan = demotePlan({
      rootAdmins,
      pointers: [chan],
      adminsByKey: { [key]: [{ pubkey: PUB, roles: ['admin', 'lehrkraft'] }] }
    });
    expect(plan).toEqual([{ pointer: chan, pubkey: PUB, roles: ['lehrkraft'] }]);
  });

  it('leaves real admins, strangers, and non-moderation channel entries alone', () => {
    const plan = demotePlan({
      rootAdmins,
      pointers: [chan],
      adminsByKey: {
        [key]: [
          { pubkey: ADMIN, roles: ['admin'] }, // real root admin
          { pubkey: STRANGER, roles: ['admin'] }, // not on the root roster at all
          { pubkey: PUB, roles: ['publisher'] } // no moderation role to strip
        ]
      }
    });
    expect(plan).toEqual([]);
  });
});
