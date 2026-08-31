/**
 * Roster-linked shareable communities — the pure pointer-match half, the
 * NIP-29 counterpart of areaLinkedCommunityPubkeys.
 *
 * The rule under test: a community whose 10222 `membership` pointer names a
 * group I am on the roster of is a community I can share into, whatever my
 * public follow set says. Being granted a role in that group is done BY AN
 * ADMIN, who cannot write my kind-30000 — so the follow set can never learn
 * about it (laoc's publisher couldn't see laoc42 in any picker, 2026-08-21).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { rosterLinkedCommunityPubkeys } from '$lib/groups/shareable-communities.js';

const GROUP_A = '0d55b35fba485756';
const GROUP_B = '1057f3c8cbd16568';
const RELAY = 'wss://groups.example/';
const PK1 = '1'.repeat(64);
const PK2 = '2'.repeat(64);
const PK3 = '3'.repeat(64);

/** @param {string} pubkey @param {string} [groupId] */
const communikey = (pubkey, groupId) => ({
  kind: 10222,
  pubkey,
  tags: groupId ? [['membership', groupId, RELAY]] : [['r', 'wss://r.example']]
});

describe('rosterLinkedCommunityPubkeys', () => {
  it('collects communities whose root group I am on the roster of, skips the rest', () => {
    const out = rosterLinkedCommunityPubkeys({
      groupIds: new Set([GROUP_A]),
      communikeyEvents: [
        communikey(PK1, GROUP_A),
        communikey(PK2, GROUP_B), // a group I am not in
        communikey(PK3) // open community, no root group
      ]
    });
    expect(out).toEqual([PK1]);
  });

  it('accepts a plain array of group ids as well as a Set', () => {
    expect(
      rosterLinkedCommunityPubkeys({
        groupIds: [GROUP_A],
        communikeyEvents: [communikey(PK1, GROUP_A)]
      })
    ).toEqual([PK1]);
  });

  it('dedupes and survives null/malformed input', () => {
    const out = rosterLinkedCommunityPubkeys({
      groupIds: new Set([GROUP_A]),
      communikeyEvents: [communikey(PK1, GROUP_A), communikey(PK1, GROUP_A), null, {}]
    });
    expect(out).toEqual([PK1]);
    expect(rosterLinkedCommunityPubkeys({ groupIds: new Set(), communikeyEvents: null })).toEqual(
      []
    );
    expect(rosterLinkedCommunityPubkeys({})).toEqual([]);
  });

  it('ignores a membership tag with no usable relay — parseMembershipPointer rejects it', () => {
    // Matches the pointer parser's own validity rule, so the two can never
    // disagree about whether a community is moderated.
    const malformed = { kind: 10222, pubkey: PK1, tags: [['membership', GROUP_A]] };
    expect(
      rosterLinkedCommunityPubkeys({
        groupIds: new Set([GROUP_A]),
        communikeyEvents: [malformed]
      })
    ).toEqual([]);
  });

  // The reported incident, with the real events copied off the relays
  // (static fixture — no network at test time). laoc tester was granted
  // `publisher` in laoc42's root group and the community was absent from
  // every picker, because their follow set only ever contained Edufeed.
  it('returns laoc42 for the roster it was actually missing from', () => {
    const LAOC42 = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
    const EDUFEED = 'bdc21f93b1e2cb75608cecd7a0a00a779779d9367dc9798bd9f213f06c95bc48';

    const laoc42Event = {
      kind: 10222,
      pubkey: LAOC42,
      tags: [
        ['membership', '0d55b35fba485756', 'wss://groups.edufeed.org'],
        ['r', 'wss://relay.edufeed.org'],
        ['strict', 'content'],
        ['content', 'Learning'],
        ['access', 'role', 'publisher'],
        ['k', '30142']
      ]
    };
    // Edufeed's root group is on a different relay and laoc tester is not on
    // its roster — it reaches the picker through the follow set instead, and
    // must not be double-counted here.
    const edufeedEvent = {
      kind: 10222,
      pubkey: EDUFEED,
      tags: [
        ['membership', 'd1a2d4361c6744b4', 'wss://groups.0xchat.com'],
        ['content', 'Learning'],
        ['k', '30142']
      ]
    };

    const out = rosterLinkedCommunityPubkeys({
      // The three groups the `#p` query returns for laoc tester.
      groupIds: ['542f0927dd1df53d', '0d55b35fba485756', '1057f3c8cbd16568'],
      communikeyEvents: [edufeedEvent, laoc42Event]
    });
    expect(out).toEqual([LAOC42]);
  });

  it('preserves event order so the picker list is stable across reads', () => {
    const out = rosterLinkedCommunityPubkeys({
      groupIds: new Set([GROUP_A, GROUP_B]),
      communikeyEvents: [communikey(PK2, GROUP_B), communikey(PK1, GROUP_A)]
    });
    expect(out).toEqual([PK2, PK1]);
  });
});
