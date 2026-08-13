/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  stufe2Pointers,
  areaMemberRows,
  fanOutPlan,
  aggregateFanOut
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

describe('areaMemberRows', () => {
  it('unions members and names where each is missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], missingKeys: [] },
      { pubkey: B, inKeys: [k1], missingKeys: [k2] }
    ]);
  });
  it('treats an unloaded roster as unknown, not missing', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A]) }
    });
    expect(rows).toEqual([{ pubkey: A, inKeys: [k1], missingKeys: [] }]);
  });

  // Handoff #11d: NIP-29 counts privileged roles as members (root-roster.js
  // follows the same rule for the ROOT group) — an admin who never got an
  // explicit 39002 entry in one of their own channels is not "missing"
  // there, just implicit. Passing adminsByKey lets area-members read that
  // the same way, so neither the badge nor a sync/repair fan-out treats
  // them as a deviation.
  it('an admin without an explicit 39002 entry counts as present, not missing (implicit membership)', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A, B]), [k2]: new Set([A]) },
      adminsByKey: { [k2]: [{ pubkey: B, roles: ['admin'] }] }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], missingKeys: [] },
      { pubkey: B, inKeys: [k1, k2], missingKeys: [] }
    ]);
  });

  // Symmetric case: an admin-only presence (no 39002 entry ANYWHERE) still
  // surfaces as a row rather than being invisible to the area view.
  it('an admin with no 39002 entry anywhere still becomes a row, fully present via role', () => {
    const rows = areaMemberRows({
      pointers: [p1, p2],
      membersByKey: { [k1]: new Set([A]), [k2]: new Set([A]) },
      adminsByKey: { [k1]: [{ pubkey: B, roles: ['admin'] }] }
    });
    expect(rows).toEqual([
      { pubkey: A, inKeys: [k1, k2], missingKeys: [] },
      { pubkey: B, inKeys: [k1], missingKeys: [k2] }
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
