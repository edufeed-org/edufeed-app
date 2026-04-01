/**
 * Badge Awards hook — unit tests for the pure logic helper
 *
 * Tests buildBadgeDisplayItems which transforms awards + definitions into display objects.
 * The hook itself (useBadgeAwards) uses Svelte runes and is tested via component/E2E tests.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// Mock all transitive dependencies to avoid browser/Svelte imports
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { stream: vi.fn(), replaceable: vi.fn() }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => () => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));
vi.mock('applesauce-core/models', () => ({
  TimelineModel: vi.fn()
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.test']
}));

const { buildBadgeDisplayItems } = await import('../stores/badge-awards.svelte.js');

/** Helper to build a kind 8 award event */
function makeAward(id, issuerPubkey, badgeAddress, created_at = 1700000000) {
  return {
    id,
    issuerPubkey,
    badgeAddress,
    created_at,
    recipients: ['recipient-pubkey'],
    rawEvent: { id, kind: 8, pubkey: issuerPubkey, created_at, tags: [], content: '' }
  };
}

/** Helper to build a badge definition (from BadgeModel output) */
function makeDefinition(address, name, description = '', image = '', thumb = '') {
  const [, pubkey, identifier] = address.split(':');
  return {
    id: 'def-' + identifier,
    pubkey,
    created_at: 1699000000,
    identifier,
    name,
    description,
    image,
    imageDimensions: '',
    thumb,
    thumbDimensions: '',
    address
  };
}

describe('buildBadgeDisplayItems', () => {
  it('returns empty array when no awards', () => {
    const result = buildBadgeDisplayItems([], new Map());
    expect(result).toEqual([]);
  });

  it('combines award + definition data correctly', () => {
    const awards = [makeAward('award1', 'issuer1', '30009:issuer1:gold-star')];
    const definitions = new Map([
      [
        '30009:issuer1:gold-star',
        makeDefinition(
          '30009:issuer1:gold-star',
          'Gold Star',
          'Great job!',
          'https://img.example/gold.png',
          'https://img.example/gold-thumb.png'
        )
      ]
    ]);

    const result = buildBadgeDisplayItems(awards, definitions);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'award1',
      badgeName: 'Gold Star',
      badgeDescription: 'Great job!',
      badgeImage: 'https://img.example/gold.png',
      badgeThumb: 'https://img.example/gold-thumb.png',
      issuerPubkey: 'issuer1',
      awardedAt: 1700000000,
      badgeAddress: '30009:issuer1:gold-star'
    });
  });

  it('deduplicates by badge address, keeping most recent', () => {
    const awards = [
      makeAward('award-old', 'issuer1', '30009:issuer1:gold-star', 1690000000),
      makeAward('award-new', 'issuer1', '30009:issuer1:gold-star', 1700000000)
    ];
    const definitions = new Map([
      ['30009:issuer1:gold-star', makeDefinition('30009:issuer1:gold-star', 'Gold Star')]
    ]);

    const result = buildBadgeDisplayItems(awards, definitions);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('award-new');
    expect(result[0].awardedAt).toBe(1700000000);
  });

  it('handles missing definitions gracefully', () => {
    const awards = [makeAward('award1', 'issuer1', '30009:issuer1:unknown-badge')];
    const definitions = new Map(); // no definitions

    const result = buildBadgeDisplayItems(awards, definitions);

    expect(result).toHaveLength(1);
    expect(result[0].badgeName).toBe('');
    expect(result[0].badgeDescription).toBe('');
    expect(result[0].badgeImage).toBe('');
    expect(result[0].badgeThumb).toBe('');
    expect(result[0].issuerPubkey).toBe('issuer1');
    expect(result[0].badgeAddress).toBe('30009:issuer1:unknown-badge');
  });

  it('sorts by awardedAt descending (most recent first)', () => {
    const awards = [
      makeAward('award1', 'issuer1', '30009:issuer1:badge-a', 1690000000),
      makeAward('award2', 'issuer2', '30009:issuer2:badge-b', 1700000000),
      makeAward('award3', 'issuer1', '30009:issuer1:badge-c', 1695000000)
    ];
    const definitions = new Map([
      ['30009:issuer1:badge-a', makeDefinition('30009:issuer1:badge-a', 'Badge A')],
      ['30009:issuer2:badge-b', makeDefinition('30009:issuer2:badge-b', 'Badge B')],
      ['30009:issuer1:badge-c', makeDefinition('30009:issuer1:badge-c', 'Badge C')]
    ]);

    const result = buildBadgeDisplayItems(awards, definitions);

    expect(result).toHaveLength(3);
    expect(result[0].badgeName).toBe('Badge B');
    expect(result[1].badgeName).toBe('Badge C');
    expect(result[2].badgeName).toBe('Badge A');
  });

  it('handles multiple badges from different issuers', () => {
    const awards = [
      makeAward('award1', 'issuerA', '30009:issuerA:badge1'),
      makeAward('award2', 'issuerB', '30009:issuerB:badge2')
    ];
    const definitions = new Map([
      ['30009:issuerA:badge1', makeDefinition('30009:issuerA:badge1', 'Alpha Badge')],
      ['30009:issuerB:badge2', makeDefinition('30009:issuerB:badge2', 'Beta Badge')]
    ]);

    const result = buildBadgeDisplayItems(awards, definitions);

    expect(result).toHaveLength(2);
    const names = result.map((r) => r.badgeName);
    expect(names).toContain('Alpha Badge');
    expect(names).toContain('Beta Badge');
  });
});
