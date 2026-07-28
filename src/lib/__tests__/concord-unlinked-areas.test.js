/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  unlinkedConcordAreas,
  linkedConcordIds,
  concordAreaDisplayName,
  attachableConcordAreas,
  privateAreaGate,
  areaAbbreviation,
  areaColorClass,
  AREA_BADGE_COLOR_CLASSES
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
      { communityId: A, name: 'Armada A', dissolved: false, iconPointer: undefined }
    ]);
  });

  it('surfaces metadata.icon as iconPointer, undefined when absent', () => {
    const withIcon = {
      material: { community_id: A, name: 'Has Icon' },
      metadata: { icon: { url: 'https://x/blob', key: 'aa', nonce: 'bb', hash: 'cc' } }
    };
    const withoutIcon = { material: { community_id: B, name: 'No Icon' } };
    const result = unlinkedConcordAreas({
      communities: [withIcon, withoutIcon],
      linkedIds: new Set()
    });
    expect(result.find((r) => r.communityId === A)?.iconPointer).toEqual({
      url: 'https://x/blob',
      key: 'aa',
      nonce: 'bb',
      hash: 'cc'
    });
    expect(result.find((r) => r.communityId === B)?.iconPointer).toBeUndefined();
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

describe('privateAreaGate', () => {
  const validId = A;

  it('returns "disabled" when the flag is off, regardless of id/login', () => {
    expect(privateAreaGate({ enabled: false, id: validId, loggedIn: true })).toBe('disabled');
    expect(privateAreaGate({ enabled: false, id: 'not-hex', loggedIn: false })).toBe('disabled');
  });

  it('returns "invalid" when enabled but the id is malformed, even if logged in', () => {
    expect(privateAreaGate({ enabled: true, id: 'not-hex', loggedIn: true })).toBe('invalid');
    expect(privateAreaGate({ enabled: true, id: undefined, loggedIn: true })).toBe('invalid');
  });

  it('returns "login" when enabled + valid id but logged out', () => {
    expect(privateAreaGate({ enabled: true, id: validId, loggedIn: false })).toBe('login');
  });

  it('returns "render" when enabled + valid id + logged in', () => {
    expect(privateAreaGate({ enabled: true, id: validId, loggedIn: true })).toBe('render');
  });
});

describe('areaAbbreviation', () => {
  it('takes the first letter of each of the first two words for multi-word names', () => {
    expect(areaAbbreviation('Soapbox Community')).toBe('SC');
  });

  it('splits hyphenated single-word names like a multi-word name', () => {
    expect(areaAbbreviation('edufeed-armada')).toBe('EA');
  });

  it('takes the first two letters, capitalized, for a genuine single word', () => {
    expect(areaAbbreviation('Concord')).toBe('CO');
  });

  it('uppercases umlauts correctly (word-per-word)', () => {
    expect(areaAbbreviation('Übung Gruppe')).toBe('ÜG');
    expect(areaAbbreviation('Über')).toBe('ÜB');
  });

  it('falls back to a placeholder for empty/whitespace-only names', () => {
    expect(areaAbbreviation('')).toBe('?');
    expect(areaAbbreviation('   ')).toBe('?');
    expect(areaAbbreviation(undefined)).toBe('?');
    expect(areaAbbreviation(null)).toBe('?');
  });

  it('collapses extra whitespace between words', () => {
    expect(areaAbbreviation('  Soapbox   Community  ')).toBe('SC');
  });

  it('handles a lone one-character word', () => {
    expect(areaAbbreviation('X')).toBe('X');
  });
});

describe('areaColorClass', () => {
  it('always returns one of the fixed palette classes', () => {
    for (const id of ['a'.repeat(64), 'b'.repeat(64), 'deadbeef', '', 'z']) {
      expect(AREA_BADGE_COLOR_CLASSES).toContain(areaColorClass(id));
    }
  });

  it('is deterministic for the same communityId', () => {
    const id = 'f'.repeat(64);
    expect(areaColorClass(id)).toBe(areaColorClass(id));
  });

  it('is stable across null/undefined (defensive, does not throw)', () => {
    expect(() => areaColorClass(undefined)).not.toThrow();
    expect(() => areaColorClass(null)).not.toThrow();
  });

  it('picks different colors for at least some different ids (not a constant function)', () => {
    // Realistic 64-char hex pubkeys (not degenerate repeated-character
    // strings — a polynomial hash's low bits can cancel out for those, but
    // real Concord communityIds are always varied hex, like these).
    const ids = [
      '3bf0d7f7fac04e56dc37e5b6a7b0b1a95f5a6f2b2f3d5f21a9c3ab6da6c7e6f',
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
      '0000000000000000000000000000000000000000000000000000000000001',
      'deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcd'
    ];
    const classes = new Set(ids.map(areaColorClass));
    expect(classes.size).toBeGreaterThan(1);
  });
});

describe('attachableConcordAreas', () => {
  const OWNER = '1'.repeat(64);
  const OTHER = '2'.repeat(64);

  /**
   * @param {string} id
   * @param {string} name
   * @param {any} [overrides]
   */
  function owned(id, name, overrides = {}) {
    return { material: { community_id: id, name, owner: OWNER }, ...overrides };
  }

  it('lists only areas the given pubkey owns', () => {
    const communities = [
      owned(A, 'Mine'),
      { material: { community_id: B, name: 'Theirs', owner: OTHER } }
    ];
    const result = attachableConcordAreas({
      communities,
      linkedIds: new Set(),
      ownerPubkey: OWNER
    });
    expect(result.map((r) => r.communityId)).toEqual([A]);
  });

  it('flags areas already linked to a joined community instead of hiding them', () => {
    const communities = [owned(A, 'Linked'), owned(B, 'Free')];
    const result = attachableConcordAreas({
      communities,
      linkedIds: new Set([A]),
      ownerPubkey: OWNER
    });
    expect(result.find((r) => r.communityId === A)?.linkedToJoined).toBe(true);
    expect(result.find((r) => r.communityId === B)?.linkedToJoined).toBe(false);
  });

  it('excludes dissolved areas entirely (attaching a tombstone is nonsense)', () => {
    const communities = [owned(A, 'Gone', { dissolved: true }), owned(B, 'Alive')];
    const result = attachableConcordAreas({
      communities,
      linkedIds: new Set(),
      ownerPubkey: OWNER
    });
    expect(result.map((r) => r.communityId)).toEqual([B]);
  });

  it('uses the shared display-name fallback chain and sorts by name', () => {
    const communities = [
      owned(B, 'Zebra'),
      {
        material: { community_id: A, name: 'Aardvark', owner: OWNER },
        metadata: { name: 'Meta A' }
      }
    ];
    const result = attachableConcordAreas({
      communities,
      linkedIds: new Set(),
      ownerPubkey: OWNER
    });
    expect(result.map((r) => r.name)).toEqual(['Meta A', 'Zebra']);
  });

  it('surfaces iconPointer and the area relays for the pointer hint', () => {
    const communities = [
      {
        material: { community_id: A, name: 'Icon', owner: OWNER, relays: ['wss://c.example'] },
        metadata: { icon: { url: 'https://x/blob' } }
      }
    ];
    const result = attachableConcordAreas({
      communities,
      linkedIds: new Set(),
      ownerPubkey: OWNER
    });
    expect(result[0].iconPointer).toEqual({ url: 'https://x/blob' });
    expect(result[0].relay).toBe('wss://c.example');
  });

  it('returns [] without an ownerPubkey (logged out) or communities', () => {
    expect(
      attachableConcordAreas({ communities: null, linkedIds: new Set(), ownerPubkey: OWNER })
    ).toEqual([]);
    expect(
      attachableConcordAreas({
        communities: [owned(A, 'X')],
        linkedIds: new Set(),
        ownerPubkey: undefined
      })
    ).toEqual([]);
  });
});
