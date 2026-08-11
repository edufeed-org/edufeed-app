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
