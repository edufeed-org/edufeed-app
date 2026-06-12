/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock eventStore.replaceable
const mockReplaceable = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: mockReplaceable
  }
}));

// Mock relay service
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => ['wss://relay.damus.io/']
}));

import {
  getDmRelaysFromEvent,
  buildDmRelayListEvent,
  DM_READ_TIMESTAMPS_KEY,
  loadReadTimestamps,
  saveReadTimestamps,
  isConversationUnread
} from '$lib/helpers/dm.js';

describe('getDmRelaysFromEvent', () => {
  it('extracts relay URLs from kind 10050 event tags', () => {
    const event = {
      kind: 10050,
      tags: [
        ['relay', 'wss://inbox.nostr.wine/'],
        ['relay', 'wss://auth.nostr1.com/']
      ]
    };
    expect(getDmRelaysFromEvent(event)).toEqual([
      'wss://inbox.nostr.wine/',
      'wss://auth.nostr1.com/'
    ]);
  });

  it('returns empty array for null event', () => {
    expect(getDmRelaysFromEvent(null)).toEqual([]);
  });

  it('returns empty array for event with no relay tags', () => {
    const event = { kind: 10050, tags: [['p', 'somepubkey']] };
    expect(getDmRelaysFromEvent(event)).toEqual([]);
  });
});

describe('buildDmRelayListEvent', () => {
  it('builds a kind 10050 event with one relay tag per relay', () => {
    const pubkey = 'abc123';
    const relays = ['wss://dm.edufeed.org/', 'wss://inbox.nostr.wine/'];
    const event = buildDmRelayListEvent(pubkey, relays);

    expect(event.kind).toBe(10050);
    expect(event.pubkey).toBe(pubkey);
    expect(event.content).toBe('');
    expect(event.tags).toEqual([
      ['relay', 'wss://dm.edufeed.org/'],
      ['relay', 'wss://inbox.nostr.wine/']
    ]);
    expect(typeof event.created_at).toBe('number');
  });

  it('builds an event with no relay tags when given an empty list', () => {
    const event = buildDmRelayListEvent('abc123', []);
    expect(event.kind).toBe(10050);
    expect(event.tags).toEqual([]);
  });
});

describe('read timestamps persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn()
    });
  });

  it('loads read timestamps from localStorage', () => {
    const data = { conv1: 1000, conv2: 2000 };
    /** @type {any} */ (localStorage.getItem).mockReturnValue(JSON.stringify(data));

    const result = loadReadTimestamps('pubkey123');
    expect(localStorage.getItem).toHaveBeenCalledWith(`${DM_READ_TIMESTAMPS_KEY}:pubkey123`);
    expect(result).toEqual(data);
  });

  it('returns empty object when localStorage is empty', () => {
    /** @type {any} */ (localStorage.getItem).mockReturnValue(null);
    expect(loadReadTimestamps('pubkey123')).toEqual({});
  });

  it('returns empty object on parse error', () => {
    /** @type {any} */ (localStorage.getItem).mockReturnValue('invalid-json');
    expect(loadReadTimestamps('pubkey123')).toEqual({});
  });

  it('saves read timestamps to localStorage', () => {
    const data = { conv1: 1000 };
    saveReadTimestamps('pubkey123', data);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      `${DM_READ_TIMESTAMPS_KEY}:pubkey123`,
      JSON.stringify(data)
    );
  });
});

describe('isConversationUnread', () => {
  it('returns true when last message is newer than read timestamp', () => {
    const readTimestamps = { conv1: 1000 };
    expect(isConversationUnread('conv1', 2000, readTimestamps)).toBe(true);
  });

  it('returns false when last message is at or before read timestamp', () => {
    const readTimestamps = { conv1: 2000 };
    expect(isConversationUnread('conv1', 2000, readTimestamps)).toBe(false);
    expect(isConversationUnread('conv1', 1000, readTimestamps)).toBe(false);
  });

  it('returns true when conversation has no read timestamp', () => {
    expect(isConversationUnread('conv1', 1000, {})).toBe(true);
  });
});
