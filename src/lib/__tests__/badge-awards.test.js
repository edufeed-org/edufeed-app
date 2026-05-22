/**
 * Profile Badges hook — unit tests for the pure logic helpers
 *
 * The hook (useProfileBadges) honours NIP-58: it shows ONLY the badges the
 * profile owner has explicitly accepted via their kind 10008 (or legacy 30008)
 * profile_badges event, in the order they chose.
 *
 * The two pure helpers are:
 *   - extractProfileBadgeSlots(event) — parses (a, e) pairs from a profile_badges event
 *   - buildProfileBadgeDisplayItems(slots, awards, definitions) — composes display items
 *
 * The hook itself uses Svelte runes and is exercised by component tests.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// Mock all transitive dependencies to avoid browser/Svelte imports
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { event: vi.fn(), replaceable: vi.fn() }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
  eventLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
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
  getAllLookupRelays: () => ['wss://relay.test'],
  getEventLoaderLookupRelays: () => []
}));

const { extractProfileBadgeSlots, buildProfileBadgeDisplayItems } = await import(
  '../stores/badge-awards.svelte.js'
);

/** Build a profile_badges event (kind 10008 / 30008) with alternating a/e pairs.
 * @param {number} kind
 * @param {Array<{ address: string, awardId: string }>} pairs
 */
function makeProfileBadges(kind, pairs) {
  const tags = [['d', 'profile_badges']];
  for (const { address, awardId } of pairs) {
    tags.push(['a', address, '']);
    tags.push(['e', awardId, '']);
  }
  return {
    id: 'pb-event',
    kind,
    pubkey: 'owner',
    created_at: 1700000000,
    tags,
    content: '',
    sig: ''
  };
}

/** Build a kind 8 award event.
 * @param {string} id
 * @param {string} issuerPubkey
 * @param {string} badgeAddress
 * @param {number} [created_at]
 */
function makeAwardEvent(id, issuerPubkey, badgeAddress, created_at = 1700000000) {
  return {
    id,
    kind: 8,
    pubkey: issuerPubkey,
    created_at,
    tags: [
      ['a', badgeAddress],
      ['p', 'owner']
    ],
    content: '',
    sig: ''
  };
}

/** Build a definition object (from BadgeModel-shaped output).
 * @param {string} address
 * @param {string} name
 * @param {string} [description]
 * @param {string} [image]
 * @param {string} [thumb]
 */
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
    thumb,
    address
  };
}

describe('extractProfileBadgeSlots', () => {
  it('returns [] for undefined or empty event', () => {
    expect(extractProfileBadgeSlots(undefined)).toEqual([]);
    expect(extractProfileBadgeSlots(null)).toEqual([]);
    expect(extractProfileBadgeSlots({ tags: [] })).toEqual([]);
  });

  it('extracts (a, e) pairs in tag order', () => {
    const event = makeProfileBadges(10008, [
      { address: '30009:issuer1:gold', awardId: 'award1' },
      { address: '30009:issuer2:silver', awardId: 'award2' }
    ]);
    expect(extractProfileBadgeSlots(event)).toEqual([
      { badgeAddress: '30009:issuer1:gold', awardId: 'award1' },
      { badgeAddress: '30009:issuer2:silver', awardId: 'award2' }
    ]);
  });

  it('skips an "a" tag not immediately followed by an "e" tag', () => {
    // Malformed: two consecutive "a"s, no matching award for the first
    const event = {
      tags: [
        ['d', 'profile_badges'],
        ['a', '30009:issuer1:gold', ''],
        ['a', '30009:issuer2:silver', ''],
        ['e', 'award2', '']
      ]
    };
    expect(extractProfileBadgeSlots(event)).toEqual([
      { badgeAddress: '30009:issuer2:silver', awardId: 'award2' }
    ]);
  });

  it('ignores unrelated tags', () => {
    const event = {
      tags: [
        ['d', 'profile_badges'],
        ['title', 'My Badges'],
        ['a', '30009:issuer1:gold', ''],
        ['e', 'award1', '']
      ]
    };
    expect(extractProfileBadgeSlots(event)).toEqual([
      { badgeAddress: '30009:issuer1:gold', awardId: 'award1' }
    ]);
  });
});

describe('buildProfileBadgeDisplayItems', () => {
  it('returns [] when no slots', () => {
    expect(buildProfileBadgeDisplayItems([], new Map(), new Map())).toEqual([]);
  });

  it('preserves slot order (NOT award timestamp order)', () => {
    const slots = [
      { badgeAddress: '30009:issuer1:bronze', awardId: 'a1' },
      { badgeAddress: '30009:issuer1:gold', awardId: 'a2' },
      { badgeAddress: '30009:issuer1:silver', awardId: 'a3' }
    ];
    // Awards in different chronological order — should NOT affect display order
    const awards = new Map([
      ['a1', makeAwardEvent('a1', 'issuer1', '30009:issuer1:bronze', 1690000000)],
      ['a2', makeAwardEvent('a2', 'issuer1', '30009:issuer1:gold', 1710000000)],
      ['a3', makeAwardEvent('a3', 'issuer1', '30009:issuer1:silver', 1700000000)]
    ]);
    const definitions = new Map([
      ['30009:issuer1:bronze', makeDefinition('30009:issuer1:bronze', 'Bronze')],
      ['30009:issuer1:gold', makeDefinition('30009:issuer1:gold', 'Gold')],
      ['30009:issuer1:silver', makeDefinition('30009:issuer1:silver', 'Silver')]
    ]);

    const result = buildProfileBadgeDisplayItems(slots, awards, definitions);
    expect(result.map((r) => r.badgeName)).toEqual(['Bronze', 'Gold', 'Silver']);
  });

  it('composes display item from slot + award + definition', () => {
    const slots = [{ badgeAddress: '30009:issuer1:gold', awardId: 'award1' }];
    const awards = new Map([
      ['award1', makeAwardEvent('award1', 'issuer1', '30009:issuer1:gold', 1705363200)]
    ]);
    const definitions = new Map([
      [
        '30009:issuer1:gold',
        makeDefinition(
          '30009:issuer1:gold',
          'Gold Star',
          'Great job!',
          'https://img/gold.png',
          'https://img/gold-thumb.png'
        )
      ]
    ]);

    expect(buildProfileBadgeDisplayItems(slots, awards, definitions)).toEqual([
      {
        id: 'award1',
        badgeName: 'Gold Star',
        badgeDescription: 'Great job!',
        badgeImage: 'https://img/gold.png',
        badgeThumb: 'https://img/gold-thumb.png',
        issuerPubkey: 'issuer1',
        awardedAt: 1705363200,
        badgeAddress: '30009:issuer1:gold'
      }
    ]);
  });

  it('still renders a slot whose award has not loaded yet', () => {
    const slots = [{ badgeAddress: '30009:issuer1:gold', awardId: 'award1' }];
    const definitions = new Map([
      ['30009:issuer1:gold', makeDefinition('30009:issuer1:gold', 'Gold Star')]
    ]);

    const result = buildProfileBadgeDisplayItems(slots, new Map(), definitions);
    expect(result).toHaveLength(1);
    expect(result[0].badgeName).toBe('Gold Star');
    // awardedAt falls back to 0 when award hasn't loaded
    expect(result[0].awardedAt).toBe(0);
    // issuerPubkey falls back to the definition's pubkey (from the address)
    expect(result[0].issuerPubkey).toBe('issuer1');
    // id falls back to the awardId so Svelte keyed-each stays stable
    expect(result[0].id).toBe('award1');
  });

  it('still renders a slot whose definition has not loaded yet', () => {
    const slots = [{ badgeAddress: '30009:issuer1:gold', awardId: 'award1' }];
    const awards = new Map([
      ['award1', makeAwardEvent('award1', 'issuer1', '30009:issuer1:gold', 1705363200)]
    ]);

    const result = buildProfileBadgeDisplayItems(slots, awards, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].badgeName).toBe('');
    expect(result[0].badgeImage).toBe('');
    expect(result[0].issuerPubkey).toBe('issuer1');
    expect(result[0].awardedAt).toBe(1705363200);
  });
});
