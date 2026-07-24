/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  unlinkedConcordAreas,
  linkedConcordIds,
  concordAreaDisplayName
} from '$lib/concord/unlinked-areas.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** @param {Partial<{community_id: string, name: string}>} material */
function community(material, extra = {}) {
  return { material: { community_id: material.community_id, name: material.name }, ...extra };
}

describe('unlinkedConcordAreas', () => {
  it('excludes memberships whose id is in linkedIds', () => {
    const communities = [community({ community_id: A, name: 'Armada A' })];
    expect(unlinkedConcordAreas({ communities, linkedIds: new Set([A]) })).toEqual([]);
  });

  it('includes memberships not in linkedIds', () => {
    const communities = [community({ community_id: A, name: 'Armada A' })];
    expect(unlinkedConcordAreas({ communities, linkedIds: new Set() })).toEqual([
      { communityId: A, name: 'Armada A', dissolved: false }
    ]);
  });

  it('name fallback chain: metadata.name > material.name > communityId slice', () => {
    const withMetadata = {
      material: { community_id: A, name: 'Material Name' },
      metadata: { name: 'Metadata Name' }
    };
    const materialOnly = { material: { community_id: B, name: 'Material Only' } };
    const neither = { material: { community_id: C, name: '' } };
    const communities = [withMetadata, materialOnly, neither];
    const result = unlinkedConcordAreas({ communities, linkedIds: new Set() });
    expect(result.find((r) => r.communityId === A)?.name).toBe('Metadata Name');
    expect(result.find((r) => r.communityId === B)?.name).toBe('Material Only');
    expect(result.find((r) => r.communityId === C)?.name).toBe(C.slice(0, 12));
  });

  it('includes dissolved areas with their flag set, not hidden', () => {
    const communities = [community({ community_id: A, name: 'Gone' }, { dissolved: true })];
    expect(unlinkedConcordAreas({ communities, linkedIds: new Set() })).toEqual([
      { communityId: A, name: 'Gone', dissolved: true }
    ]);
  });

  it('dedups by communityId, keeping the first occurrence', () => {
    const communities = [
      community({ community_id: A, name: 'First' }),
      community({ community_id: A, name: 'Second' })
    ];
    const result = unlinkedConcordAreas({ communities, linkedIds: new Set() });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('First');
  });

  it('sorts by name', () => {
    const communities = [
      community({ community_id: B, name: 'Zebra' }),
      community({ community_id: A, name: 'Alpha' })
    ];
    const result = unlinkedConcordAreas({ communities, linkedIds: new Set() });
    expect(result.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('handles empty/missing input gracefully', () => {
    expect(unlinkedConcordAreas({ communities: [], linkedIds: new Set() })).toEqual([]);
    expect(unlinkedConcordAreas({ communities: undefined, linkedIds: new Set() })).toEqual([]);
  });

  it('skips malformed community entries (no material/community_id)', () => {
    const communities = [
      {},
      { material: {} },
      null,
      undefined,
      community({ community_id: A, name: 'Ok' })
    ];
    const result = unlinkedConcordAreas({ communities, linkedIds: new Set() });
    expect(result).toEqual([{ communityId: A, name: 'Ok', dissolved: false }]);
  });
});

describe('concordAreaDisplayName', () => {
  it('follows the same fallback chain as unlinkedConcordAreas', () => {
    expect(
      concordAreaDisplayName({
        material: { community_id: A, name: 'Material' },
        metadata: { name: 'Meta' }
      })
    ).toBe('Meta');
    expect(concordAreaDisplayName({ material: { community_id: A, name: 'Material' } })).toBe(
      'Material'
    );
    expect(concordAreaDisplayName({ material: { community_id: A, name: '' } })).toBe(
      A.slice(0, 12)
    );
  });
  it('handles missing/malformed state', () => {
    expect(concordAreaDisplayName(undefined)).toBe('');
    expect(concordAreaDisplayName({})).toBe('');
  });
});

describe('linkedConcordIds', () => {
  it('collects pointer ids from kind 10222 events', () => {
    const events = [
      { kind: 10222, tags: [['concord', A]] },
      { kind: 10222, tags: [['concord', B, 'wss://c.example']] }
    ];
    expect(linkedConcordIds(events)).toEqual(new Set([A, B]));
  });

  it('skips events without a valid pointer', () => {
    const events = [
      { kind: 10222, tags: [] },
      { kind: 10222, tags: [['concord', 'not-hex']] },
      null,
      undefined
    ];
    expect(linkedConcordIds(events)).toEqual(new Set());
  });

  it('handles empty/missing input', () => {
    expect(linkedConcordIds([])).toEqual(new Set());
    expect(linkedConcordIds(undefined)).toEqual(new Set());
  });
});
