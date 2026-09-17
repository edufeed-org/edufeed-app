/** @vitest-environment node */
/**
 * Per-relay rank merging for NIP-50 search results.
 *
 * The AMB relay's README says: relevance scores are relative to one
 * response and not comparable across relays — clients merging results from
 * several relays should merge by per-relay rank and dedupe by address.
 */
import { describe, it, expect } from 'vitest';
import { searchRankKey, mergeByRelayRank, buildRankIndex } from '../searchRank.js';

/**
 * @param {string} id
 * @param {string} d
 * @param {number} [created_at]
 * @returns {import('nostr-tools').Event}
 */
function amb(id, d, created_at = 100) {
  return { id, kind: 30142, pubkey: 'author', created_at, tags: [['d', d]], content: '', sig: '' };
}

/**
 * @param {string} id
 * @param {number} kind
 * @returns {import('nostr-tools').Event}
 */
function bare(id, kind) {
  return { id, kind, pubkey: 'author', created_at: 1, tags: [], content: '', sig: '' };
}

describe('searchRankKey', () => {
  it('keys addressable events by kind:pubkey:d', () => {
    expect(searchRankKey(amb('e1', 'res-1'))).toBe('30142:author:res-1');
  });

  it('falls back to the event id for non-addressable events', () => {
    expect(searchRankKey(bare('n1', 1))).toBe('n1');
  });

  it('falls back to the event id when an addressable event has no d tag', () => {
    expect(searchRankKey(bare('x1', 30142))).toBe('x1');
  });
});

describe('mergeByRelayRank', () => {
  it('interleaves relays by rank: rank 1 of each relay, then rank 2, …', () => {
    const relayA = [amb('a1', 'A1'), amb('a2', 'A2'), amb('a3', 'A3')];
    const relayB = [amb('b1', 'B1'), amb('b2', 'B2')];

    const merged = mergeByRelayRank([relayA, relayB]);

    expect(merged.map((e) => e.id)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('dedupes the same address across relays, keeping its best rank', () => {
    const shared = amb('s1', 'shared');
    const relayA = [amb('a1', 'A1'), amb('a2', 'A2'), shared];
    const relayB = [shared, amb('b2', 'B2')];

    const merged = mergeByRelayRank([relayA, relayB]);

    // shared is rank 3 on A but rank 1 on B → placed at rank 1 (after A's rank 1)
    expect(merged.map((e) => e.id)).toEqual(['a1', 's1', 'a2', 'b2']);
  });

  it('dedupes different versions of the same address, keeping the newest event', () => {
    const older = amb('old', 'res', 100);
    const newer = amb('new', 'res', 200);
    const relayA = [older];
    const relayB = [amb('b1', 'B1'), newer];

    const merged = mergeByRelayRank([relayA, relayB]);

    expect(merged.map((e) => e.id)).toEqual(['new', 'b1']);
  });

  it('breaks rank ties by relay order (first configured relay wins)', () => {
    const merged = mergeByRelayRank([[amb('b1', 'B1')], [amb('a1', 'A1')]]);
    expect(merged.map((e) => e.id)).toEqual(['b1', 'a1']);
  });

  it('returns an empty list for no relays or empty relays', () => {
    expect(mergeByRelayRank([])).toEqual([]);
    expect(mergeByRelayRank([[], []])).toEqual([]);
  });
});

describe('buildRankIndex', () => {
  it('maps each result key to its merged position', () => {
    const relayA = [amb('a1', 'A1'), amb('a2', 'A2')];
    const relayB = [amb('b1', 'B1')];

    const index = buildRankIndex([relayA, relayB]);

    expect(index.get('30142:author:A1')).toBe(0);
    expect(index.get('30142:author:B1')).toBe(1);
    expect(index.get('30142:author:A2')).toBe(2);
    expect(index.size).toBe(3);
  });
});
