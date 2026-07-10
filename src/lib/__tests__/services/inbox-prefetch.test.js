/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), model: vi.fn(), replaceable: vi.fn() }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => ({ subscribe: vi.fn() })),
  eventLoader: vi.fn(() => ({ subscribe: vi.fn() }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => ['wss://relay3'],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1', 'wss://lookup2'],
  getEventLoaderLookupRelays: () => []
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn()
}));
vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));
vi.mock('applesauce-common/blueprints', () => ({
  AppDataBlueprint: vi.fn()
}));
vi.mock('applesauce-core/event-factory', () => ({
  EventFactory: vi.fn()
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({}))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null }
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => ['wss://lookup1']
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: vi.fn((aTag) => {
    const value = Array.isArray(aTag) ? aTag[1] : aTag;
    if (!value) return null;
    const firstColon = value.indexOf(':');
    const secondColon = value.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return null;
    return {
      kind: parseInt(value.substring(0, firstColon), 10),
      pubkey: value.substring(firstColon + 1, secondColon),
      identifier: value.substring(secondColon + 1)
    };
  })
}));

describe('extractReferencedPointers', () => {
  /** @type {import('$lib/services/inbox-service.svelte.js').extractReferencedPointers} */
  let extractReferencedPointers;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('$lib/services/inbox-service.svelte.js');
    extractReferencedPointers = mod.extractReferencedPointers;
  });

  it('extracts address pointer from reaction with a-tag', () => {
    const event = {
      id: 'evt1',
      pubkey: 'pk1',
      kind: 7,
      created_at: 1000,
      content: '+',
      tags: [
        ['e', 'someid', 'wss://relay.hint'],
        ['a', '31922:authorpk:my-event', 'wss://cal.relay']
      ],
      sig: ''
    };

    const { addressPointers, eventPointers } = extractReferencedPointers(event);

    expect(addressPointers).toHaveLength(1);
    expect(addressPointers[0]).toEqual({
      kind: 31922,
      pubkey: 'authorpk',
      identifier: 'my-event',
      relays: ['wss://cal.relay']
    });

    expect(eventPointers).toHaveLength(1);
    expect(eventPointers[0]).toEqual({
      id: 'someid',
      relays: ['wss://relay.hint']
    });
  });

  it('uses lookup relays when no relay hint in tag', () => {
    const event = {
      id: 'evt2',
      pubkey: 'pk1',
      kind: 7,
      created_at: 1000,
      content: '+',
      tags: [['a', '30142:authorpk:resource-id']],
      sig: ''
    };

    const { addressPointers } = extractReferencedPointers(event);

    expect(addressPointers).toHaveLength(1);
    expect(addressPointers[0].relays).toEqual(['wss://lookup1', 'wss://lookup2']);
  });

  it('returns empty arrays for mention notifications', () => {
    const event = {
      id: 'evt3',
      pubkey: 'pk1',
      kind: 9,
      created_at: 1000,
      content: 'hello',
      tags: [
        ['h', 'community1'],
        ['p', 'tagged-user']
      ],
      sig: ''
    };

    const { addressPointers, eventPointers } = extractReferencedPointers(event);
    expect(addressPointers).toHaveLength(0);
    expect(eventPointers).toHaveLength(0);
  });

  it('extracts event pointer from comment with e-tag', () => {
    const event = {
      id: 'evt4',
      pubkey: 'pk1',
      kind: 1111,
      created_at: 1000,
      content: 'nice',
      tags: [
        ['e', 'parent-event-id', 'wss://hint.relay'],
        ['p', 'someone']
      ],
      sig: ''
    };

    const { eventPointers } = extractReferencedPointers(event);

    expect(eventPointers).toHaveLength(1);
    expect(eventPointers[0]).toEqual({
      id: 'parent-event-id',
      relays: ['wss://hint.relay']
    });
  });

  it('extracts from RSVP (kind 31925) with A-tag', () => {
    const event = {
      id: 'evt5',
      pubkey: 'pk1',
      kind: 31925,
      created_at: 1000,
      content: '',
      tags: [['A', '31922:calpk:event-d-tag', 'wss://cal.relay']],
      sig: ''
    };

    const { addressPointers } = extractReferencedPointers(event);

    expect(addressPointers).toHaveLength(1);
    expect(addressPointers[0]).toEqual({
      kind: 31922,
      pubkey: 'calpk',
      identifier: 'event-d-tag',
      relays: ['wss://cal.relay']
    });
  });

  it('handles events with no matching tags gracefully', () => {
    const event = {
      id: 'evt6',
      pubkey: 'pk1',
      kind: 7,
      created_at: 1000,
      content: '+',
      tags: [['p', 'someone']],
      sig: ''
    };

    const { addressPointers, eventPointers } = extractReferencedPointers(event);
    expect(addressPointers).toHaveLength(0);
    expect(eventPointers).toHaveLength(0);
  });
});
