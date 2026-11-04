/** @vitest-environment node */
/**
 * NIP-29 pinned messages — the pure read side. A group's pin list is either
 * the relay's own kind 39005 (regenerated from the latest accepted kind 9010
 * `update-pin-list`) or, on a relay that stores the 9010 but never emits a
 * 39005 (groups.edufeed.org, probed 2026-11-03), the newest stored 9010
 * itself. Both carry the FULL list, so the newest one wins outright.
 */
import { describe, it, expect } from 'vitest';
import {
  UPDATE_PIN_LIST_KIND,
  PINNED_EVENTS_KIND,
  MAX_PINS,
  getPinnedIds,
  getPinnedRefs,
  resolvePinnedIds,
  resolvePinnedRefs
} from '$lib/groups/pins.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** @param {number} kind @param {string[][]} tags @param {number} created_at */
const ev = (kind, tags, created_at, id = `${kind}-${created_at}`) => ({
  id,
  kind,
  pubkey: 'f'.repeat(64),
  content: '',
  created_at,
  tags
});

describe('kinds', () => {
  it('names the NIP-29 pin kinds and the app-side cap', () => {
    expect(UPDATE_PIN_LIST_KIND).toBe(9010);
    expect(PINNED_EVENTS_KIND).toBe(39005);
    expect(MAX_PINS).toBe(25);
  });
});

describe('getPinnedIds', () => {
  it('reads the e tags of a 39005 in list order', () => {
    const pinned = ev(
      39005,
      [
        ['d', 'g'],
        ['e', B],
        ['e', A]
      ],
      10
    );
    expect(getPinnedIds(pinned)).toEqual([B, A]);
  });

  it('reads the e tags of a 9010 the same way', () => {
    const update = ev(
      9010,
      [
        ['h', 'g'],
        ['e', A]
      ],
      10
    );
    expect(getPinnedIds(update)).toEqual([A]);
  });

  it('drops duplicates and malformed ids (a repeated tag must not crash a keyed each)', () => {
    const update = ev(
      9010,
      [['h', 'g'], ['e', A], ['e', A], ['e', 'nope'], ['e'], ['a', '30023:x:y']],
      10
    );
    expect(getPinnedIds(update)).toEqual([A]);
  });

  it('is empty for nothing', () => {
    expect(getPinnedIds(null)).toEqual([]);
    expect(getPinnedIds(ev(9010, [['h', 'g']], 10))).toEqual([]);
  });
});

describe('resolvePinnedIds', () => {
  it('is empty without any list', () => {
    expect(resolvePinnedIds({ groupId: 'g', pinnedEvents: [], updateEvents: [] })).toEqual([]);
  });

  it('takes the relay 39005 when it is the only list', () => {
    const pinned = ev(
      39005,
      [
        ['d', 'g'],
        ['e', A]
      ],
      10
    );
    expect(resolvePinnedIds({ groupId: 'g', pinnedEvents: [pinned], updateEvents: [] })).toEqual([
      A
    ]);
  });

  it('falls back to the newest stored 9010 when the relay emits no 39005', () => {
    const older = ev(
      9010,
      [
        ['h', 'g'],
        ['e', A]
      ],
      10
    );
    const newer = ev(
      9010,
      [
        ['h', 'g'],
        ['e', B],
        ['e', C]
      ],
      20
    );
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [], updateEvents: [older, newer] })
    ).toEqual([B, C]);
    // order of arrival must not matter
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [], updateEvents: [newer, older] })
    ).toEqual([B, C]);
  });

  it('a 9010 newer than the 39005 wins — the relay has not regenerated yet', () => {
    const pinned = ev(
      39005,
      [
        ['d', 'g'],
        ['e', A]
      ],
      10
    );
    const update = ev(
      9010,
      [
        ['h', 'g'],
        ['e', A],
        ['e', B]
      ],
      11
    );
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [pinned], updateEvents: [update] })
    ).toEqual([A, B]);
  });

  it('on equal timestamps the relay 39005 wins (it was regenerated FROM that 9010)', () => {
    const pinned = ev(
      39005,
      [
        ['d', 'g'],
        ['e', B]
      ],
      10
    );
    const update = ev(
      9010,
      [
        ['h', 'g'],
        ['e', A]
      ],
      10
    );
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [pinned], updateEvents: [update] })
    ).toEqual([B]);
  });

  it('an unpin-everything 9010 (no e tags) clears the list', () => {
    const pinned = ev(
      39005,
      [
        ['d', 'g'],
        ['e', A]
      ],
      10
    );
    const clear = ev(9010, [['h', 'g']], 11);
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [pinned], updateEvents: [clear] })
    ).toEqual([]);
  });

  it('ignores lists bound to another group', () => {
    const other = ev(
      39005,
      [
        ['d', 'other'],
        ['e', A]
      ],
      10
    );
    const otherUpdate = ev(
      9010,
      [
        ['h', 'other'],
        ['e', B]
      ],
      20
    );
    expect(
      resolvePinnedIds({ groupId: 'g', pinnedEvents: [other], updateEvents: [otherUpdate] })
    ).toEqual([]);
  });
});

// NIP-29 lets a pin list carry addressable events as `a` tags next to the
// `e` tags. The chat shows only messages, but every list we publish is the
// FULL list — so `a` entries other clients pinned must survive a pin or
// unpin from here, in their place.
const MEETING = `31923:${'d'.repeat(64)}:meeting-1`;

describe('getPinnedRefs', () => {
  it('keeps e and a entries in list order', () => {
    const list = ev(
      39005,
      [
        ['d', 'g'],
        ['e', A],
        ['a', MEETING],
        ['e', B]
      ],
      10
    );
    expect(getPinnedRefs(list)).toEqual([
      { type: 'e', value: A },
      { type: 'a', value: MEETING },
      { type: 'e', value: B }
    ]);
    expect(getPinnedIds(list)).toEqual([A, B]);
  });

  it('drops malformed and repeated entries of both kinds', () => {
    const list = ev(
      9010,
      [
        ['h', 'g'],
        ['a', MEETING],
        ['a', MEETING],
        ['a', '30023:x:y'],
        ['a'],
        ['e', 'nope'],
        ['e', A]
      ],
      10
    );
    expect(getPinnedRefs(list)).toEqual([
      { type: 'a', value: MEETING },
      { type: 'e', value: A }
    ]);
  });
});

describe('resolvePinnedRefs', () => {
  it('returns the newest list with its a entries; resolvePinnedIds is its e side', () => {
    const args = {
      groupId: 'g',
      pinnedEvents: [
        ev(
          39005,
          [
            ['d', 'g'],
            ['a', MEETING],
            ['e', C]
          ],
          20
        )
      ],
      updateEvents: [
        ev(
          9010,
          [
            ['h', 'g'],
            ['e', A]
          ],
          10
        )
      ]
    };
    expect(resolvePinnedRefs(args)).toEqual([
      { type: 'a', value: MEETING },
      { type: 'e', value: C }
    ]);
    expect(resolvePinnedIds(args)).toEqual([C]);
  });
});
