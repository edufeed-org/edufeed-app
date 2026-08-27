/**
 * Shareable communities — the pure pointer-match half. The rule under test:
 * a community whose 10222 names one of MY areas is shareable even though I
 * never (publicly) follow-set-joined it; everything else stays out.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { areaLinkedCommunityPubkeys } from '$lib/concord/shareable-communities.js';

const AREA_A = 'a'.repeat(64);
const AREA_B = 'b'.repeat(64);
const PK1 = '1'.repeat(64);
const PK2 = '2'.repeat(64);

/** @param {string} pubkey @param {string} [areaId] */
const communikey = (pubkey, areaId) => ({
  kind: 10222,
  pubkey,
  tags: areaId ? [['concord', areaId, 'wss://concord.example']] : [['r', 'wss://r.example']]
});

describe('areaLinkedCommunityPubkeys', () => {
  it('collects communities pointing at my areas, skips the rest', () => {
    const out = areaLinkedCommunityPubkeys({
      areaIds: new Set([AREA_A]),
      communikeyEvents: [
        communikey(PK1, AREA_A),
        communikey(PK2, AREA_B), // someone else's area
        communikey('3'.repeat(64)) // no pointer at all
      ]
    });
    expect(out).toEqual([PK1]);
  });

  it('dedupes and survives null/malformed input', () => {
    const out = areaLinkedCommunityPubkeys({
      areaIds: new Set([AREA_A]),
      communikeyEvents: [communikey(PK1, AREA_A), communikey(PK1, AREA_A), null, {}]
    });
    expect(out).toEqual([PK1]);
    expect(areaLinkedCommunityPubkeys({ areaIds: new Set(), communikeyEvents: null })).toEqual([]);
  });
});
