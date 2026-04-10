/**
 * Community Definition Parser Tests
 *
 * Tests parseCommunityContentTypes and parseCommunityMetadata from communityRelays.js
 * Covers old-spec (badges, exclusive, fee, roles, per-section relays),
 * new-spec (profile list a-tags), and mixed tags.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  parseCommunityContentTypes,
  parseCommunityMetadata,
  getCommunityGlobalRelays,
  getCommunityRelaysByEnforcement,
  getRelaysForKind,
  getAllCommunityRelays,
  getKindBadgeRequirements
} from '../helpers/communityRelays.js';

/**
 * Helper to build a minimal kind 10222 event with given tags
 * @param {string[][]} tags
 */
function makeEvent(tags) {
  return { kind: 10222, pubkey: 'community-pubkey', tags, content: '', created_at: 1700000000 };
}

// ─── OLD-SPEC PARSING ───────────────────────────────────────────────────────

describe('parseCommunityContentTypes — old-spec tags', () => {
  it('parses content sections with kinds', () => {
    const event = makeEvent([
      ['content', 'Chat'],
      ['k', '9'],
      ['content', 'Calendar'],
      ['k', '31922'],
      ['k', '31923']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: 'Chat', kinds: [9] });
    expect(result[1]).toMatchObject({ name: 'Calendar', kinds: [31922, 31923] });
  });

  it('parses exclusive tag', () => {
    const event = makeEvent([
      ['content', 'Chat'],
      ['k', '9'],
      ['exclusive', 'true']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].exclusive).toBe(true);
  });

  it('parses fee tag', () => {
    const event = makeEvent([
      ['content', 'Premium'],
      ['k', '30023'],
      ['fee', '1000', 'sat']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].fee).toEqual({ amount: '1000', unit: 'sat' });
  });

  it('defaults fee unit to sat', () => {
    const event = makeEvent([
      ['content', 'Premium'],
      ['k', '30023'],
      ['fee', '500']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].fee).toEqual({ amount: '500', unit: 'sat' });
  });

  it('parses role tag', () => {
    const event = makeEvent([
      ['content', 'Moderation'],
      ['k', '1984'],
      ['role', 'admin', 'moderator']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].roles).toEqual(['admin', 'moderator']);
  });

  it('parses 30009 badge a-tags (read and write)', () => {
    const event = makeEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30009:badgepub:member', 'read'],
      ['a', '30009:badgepub:contributor', 'write']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].badges.read).toBe('30009:badgepub:member');
    expect(result[0].badges.write).toBe('30009:badgepub:contributor');
  });

  it('defaults badge qualifier to write', () => {
    const event = makeEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30009:badgepub:member']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].badges.write).toBe('30009:badgepub:member');
    expect(result[0].badges.read).toBeNull();
  });

  it('parses per-section relays', () => {
    const event = makeEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['r', 'wss://edu.relay', 'content']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].relays).toEqual(['wss://edu.relay']);
  });

  it('returns empty array for null/invalid event', () => {
    expect(parseCommunityContentTypes(null)).toEqual([]);
    expect(parseCommunityContentTypes({})).toEqual([]);
    expect(parseCommunityContentTypes({ tags: 'not-array' })).toEqual([]);
  });

  it('provides default values for all fields', () => {
    const event = makeEvent([
      ['content', 'Minimal'],
      ['k', '1']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0]).toMatchObject({
      name: 'Minimal',
      kinds: [1],
      exclusive: false,
      roles: [],
      badges: { read: null, write: null },
      relays: [],
      profileList: null,
      profileListRelay: null
    });
  });
});

// ─── NEW-SPEC PARSING ───────────────────────────────────────────────────────

describe('parseCommunityContentTypes — new-spec tags', () => {
  it('parses 30000 profile list a-tags', () => {
    const event = makeEvent([
      ['content', 'Chat'],
      ['k', '9'],
      ['a', '30000:community-pubkey:Chat', 'wss://relay.example.com']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].profileList).toBe('30000:community-pubkey:Chat');
    expect(result[0].profileListRelay).toBe('wss://relay.example.com');
  });

  it('handles profile list a-tag without relay hint', () => {
    const event = makeEvent([
      ['content', 'Forum'],
      ['k', '11'],
      ['a', '30000:community-pubkey:Forum']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].profileList).toBe('30000:community-pubkey:Forum');
    expect(result[0].profileListRelay).toBeNull();
  });
});

// ─── MIXED TAGS (partially migrated community) ─────────────────────────────

describe('parseCommunityContentTypes — mixed old+new tags', () => {
  it('parses both badge and profile list a-tags in same section', () => {
    const event = makeEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30009:badgepub:contributor', 'write'],
      ['a', '30000:community-pubkey:Learning', 'wss://relay.example.com']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result[0].badges.write).toBe('30009:badgepub:contributor');
    expect(result[0].profileList).toBe('30000:community-pubkey:Learning');
    expect(result[0].profileListRelay).toBe('wss://relay.example.com');
  });

  it('handles sections with old-spec tags and sections with new-spec tags', () => {
    const event = makeEvent([
      // Old-spec section
      ['content', 'Calendar'],
      ['k', '31923'],
      ['exclusive', 'true'],
      ['a', '30009:badgepub:member', 'read'],
      ['r', 'wss://cal.relay', 'content'],
      // New-spec section
      ['content', 'Chat'],
      ['k', '9'],
      ['a', '30000:community-pubkey:Chat', 'wss://relay.example.com']
    ]);
    const result = parseCommunityContentTypes(event);
    expect(result).toHaveLength(2);

    // Old-spec section preserved
    expect(result[0]).toMatchObject({
      name: 'Calendar',
      exclusive: true,
      badges: { read: '30009:badgepub:member', write: null },
      relays: ['wss://cal.relay'],
      profileList: null
    });

    // New-spec section
    expect(result[1]).toMatchObject({
      name: 'Chat',
      profileList: '30000:community-pubkey:Chat',
      profileListRelay: 'wss://relay.example.com',
      badges: { read: null, write: null }
    });
  });
});

// ─── parseCommunityMetadata ─────────────────────────────────────────────────

describe('parseCommunityMetadata', () => {
  it('parses global relays with enforced flag', () => {
    const event = makeEvent([
      ['r', 'wss://relay1.example.com', 'enforced'],
      ['r', 'wss://relay2.example.com'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.relays).toEqual([
      { url: 'wss://relay1.example.com', enforced: true },
      { url: 'wss://relay2.example.com', enforced: false }
    ]);
  });

  it('parses languages', () => {
    const event = makeEvent([
      ['l', 'en', 'ISO-639-1'],
      ['l', 'de', 'ISO-639-1'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.languages).toEqual(['en', 'de']);
  });

  it('parses blossom servers', () => {
    const event = makeEvent([
      ['blossom', 'https://blossom.example.com'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.blossomServers).toEqual(['https://blossom.example.com']);
  });

  it('parses mints', () => {
    const event = makeEvent([
      ['mint', 'https://mint.example.com', 'cashu'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.mints).toEqual(['https://mint.example.com']);
  });

  it('parses tos, location, geohash', () => {
    const event = makeEvent([
      ['tos', 'event-id-123', 'wss://relay.example.com'],
      ['location', 'Berlin, Germany'],
      ['g', 'u33dc'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.tos).toBe('event-id-123');
    expect(result.location).toBe('Berlin, Germany');
    expect(result.geohash).toBe('u33dc');
  });

  it('stops parsing at first content section', () => {
    const event = makeEvent([
      ['r', 'wss://global.relay'],
      ['content', 'Chat'],
      ['r', 'wss://section.relay', 'content'],
      ['l', 'en', 'ISO-639-1']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.relays).toEqual([{ url: 'wss://global.relay', enforced: false }]);
    // Language tag after content section should not be picked up
    expect(result.languages).toEqual([]);
  });

  it('returns defaults for null/invalid event', () => {
    const result = parseCommunityMetadata(null);
    expect(result.relays).toEqual([]);
    expect(result.blossomServers).toEqual([]);
    expect(result.languages).toEqual([]);
  });

  it('ignores l-tags without ISO-639-1 namespace', () => {
    const event = makeEvent([
      ['l', 'some-label', 'other-namespace'],
      ['l', 'en', 'ISO-639-1'],
      ['content', 'Chat']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.languages).toEqual(['en']);
  });

  it('parses livekit operator URL', () => {
    const event = makeEvent([
      ['livekit', 'https://operator.example.com'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.livekitUrl).toBe('https://operator.example.com');
  });

  it('returns null livekitUrl when no livekit tag', () => {
    const event = makeEvent([
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = parseCommunityMetadata(event);
    expect(result.livekitUrl).toBeNull();
  });
});

// ─── EXISTING EXPORTS (backward compat) ─────────────────────────────────────

describe('getCommunityGlobalRelays', () => {
  it('returns global relays excluding per-section relays', () => {
    const event = makeEvent([
      ['r', 'wss://global.relay'],
      ['r', 'wss://global2.relay', 'enforced'],
      ['content', 'Chat'],
      ['k', '9'],
      ['r', 'wss://section.relay', 'content']
    ]);
    const result = getCommunityGlobalRelays(event);
    expect(result).toContain('wss://global.relay');
    expect(result).toContain('wss://global2.relay');
    expect(result).not.toContain('wss://section.relay');
  });
});

describe('getRelaysForKind', () => {
  it('returns section relays when defined', () => {
    const event = makeEvent([
      ['r', 'wss://global.relay'],
      ['content', 'Learning'],
      ['k', '30142'],
      ['r', 'wss://edu.relay', 'content']
    ]);
    expect(getRelaysForKind(event, 30142)).toEqual(['wss://edu.relay']);
  });

  it('falls back to global relays', () => {
    const event = makeEvent([
      ['r', 'wss://global.relay'],
      ['content', 'Learning'],
      ['k', '30142']
    ]);
    expect(getRelaysForKind(event, 30142)).toEqual(['wss://global.relay']);
  });
});

describe('getAllCommunityRelays', () => {
  it('returns union of global and section relays', () => {
    const event = makeEvent([
      ['r', 'wss://global.relay'],
      ['content', 'Learning'],
      ['k', '30142'],
      ['r', 'wss://edu.relay', 'content']
    ]);
    const result = getAllCommunityRelays(event);
    expect(result).toContain('wss://global.relay');
    expect(result).toContain('wss://edu.relay');
  });
});

describe('getCommunityRelaysByEnforcement', () => {
  it('splits relays by enforcement status', () => {
    const event = makeEvent([
      ['r', 'wss://enforced.relay', 'enforced'],
      ['r', 'wss://open.relay'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = getCommunityRelaysByEnforcement(event);
    expect(result.enforced).toEqual(['wss://enforced.relay']);
    expect(result.open).toEqual(['wss://open.relay']);
  });

  it('returns empty arrays for null event', () => {
    const result = getCommunityRelaysByEnforcement(null);
    expect(result.enforced).toEqual([]);
    expect(result.open).toEqual([]);
  });

  it('returns all in open when no enforced relays', () => {
    const event = makeEvent([
      ['r', 'wss://r1.relay'],
      ['r', 'wss://r2.relay'],
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = getCommunityRelaysByEnforcement(event);
    expect(result.enforced).toEqual([]);
    expect(result.open).toEqual(['wss://r1.relay', 'wss://r2.relay']);
  });
});

describe('getKindBadgeRequirements', () => {
  it('returns badge requirements for a kind', () => {
    const event = makeEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30009:pub:read-badge', 'read'],
      ['a', '30009:pub:write-badge', 'write']
    ]);
    const result = getKindBadgeRequirements(event, 30142);
    expect(result.hasBadgeGating).toBe(true);
    expect(result.readBadge).toBe('30009:pub:read-badge');
    expect(result.writeBadge).toBe('30009:pub:write-badge');
  });

  it('returns no gating when no badges', () => {
    const event = makeEvent([
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const result = getKindBadgeRequirements(event, 9);
    expect(result.hasBadgeGating).toBe(false);
  });
});
