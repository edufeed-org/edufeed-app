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
  computeBaseGiftWrapRelays,
  filterEventsNeedingSignerUnlock,
  giftWrapSealCacheKeys,
  DM_READ_TIMESTAMPS_KEY,
  loadReadTimestamps,
  saveReadTimestamps,
  advanceReadTimestamps,
  isConversationUnread
} from '$lib/helpers/dm.js';

describe('computeBaseGiftWrapRelays', () => {
  it('includes read relays so wraps routed to the inbox are caught', () => {
    const result = computeBaseGiftWrapRelays(
      ['wss://write.example/'],
      ['wss://read.example/'],
      ['wss://fallback.example/']
    );
    expect(result).toContain('wss://read.example/');
    expect(result).toContain('wss://write.example/');
    expect(result).toContain('wss://fallback.example/');
  });

  it('dedupes overlapping write/read/fallback relays', () => {
    const result = computeBaseGiftWrapRelays(
      ['wss://a/', 'wss://b/'],
      ['wss://b/', 'wss://c/'],
      ['wss://a/']
    );
    expect(result).toEqual(['wss://a/', 'wss://b/', 'wss://c/']);
  });

  it('tolerates undefined inputs and drops empties', () => {
    expect(computeBaseGiftWrapRelays(undefined, undefined, undefined)).toEqual([]);
    expect(computeBaseGiftWrapRelays(['wss://a/'], undefined, [''])).toEqual(['wss://a/']);
  });
});

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

  // QA round 3 B2: an invitation sent from the schedule dialog set no marker.
  it("is never unread when the newest message is the user's own", () => {
    expect(isConversationUnread('conv1', 1000, {}, { lastAuthor: 'me', self: 'me' })).toBe(false);
    expect(isConversationUnread('conv1', 1000, {}, { lastAuthor: 'peer', self: 'me' })).toBe(true);
    expect(isConversationUnread('conv1', 1000, {}, { lastAuthor: undefined, self: null })).toBe(
      true
    );
  });
});

// Issue 7872bcbd: conversations read long ago showed as unread again on a
// later visit. The thread marks "read up to the newest message it currently
// shows", and right after a reload that is a partial set (wraps still
// restoring / the relay not yet delivering) — so the stored marker was
// overwritten with an OLDER timestamp, and the real newest message, once it
// arrived, counted as unread. A read marker must only ever move forward.
describe('advanceReadTimestamps', () => {
  it('raises a marker to a newer timestamp', () => {
    expect(advanceReadTimestamps({ conv1: 1000 }, { conv1: 2000 })).toEqual({ conv1: 2000 });
  });

  it('never lowers an existing marker', () => {
    expect(advanceReadTimestamps({ conv1: 2000 }, { conv1: 1500 })).toEqual({ conv1: 2000 });
  });

  it('adds markers for conversations without one', () => {
    expect(advanceReadTimestamps({ conv1: 2000 }, { conv2: 500 })).toEqual({
      conv1: 2000,
      conv2: 500
    });
  });

  it('keeps markers the update does not mention', () => {
    const next = advanceReadTimestamps({ conv1: 2000, conv2: 300 }, { conv2: 400 });
    expect(next).toEqual({ conv1: 2000, conv2: 400 });
  });

  it('returns a new object and leaves the input untouched', () => {
    const before = { conv1: 1000 };
    const next = advanceReadTimestamps(before, { conv1: 2000 });
    expect(next).not.toBe(before);
    expect(before).toEqual({ conv1: 1000 });
  });

  it('ignores non-finite timestamps', () => {
    expect(advanceReadTimestamps({ conv1: 1000 }, { conv1: NaN, conv2: undefined })).toEqual({
      conv1: 1000
    });
  });
});

describe('saveReadTimestamps', () => {
  it('survives a storage write failure (quota, private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      })
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveReadTimestamps('pubkey123', { conv1: 1 })).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('filterEventsNeedingSignerUnlock (decrypt-storm guard)', () => {
  const cacheWith = (/** @type {Record<string, string>} */ entries) => ({
    getItem: async (/** @type {string} */ id) => entries[id] ?? null,
    setItem: async () => {}
  });

  const wrap = (/** @type {string} */ id) =>
    /** @type {any} */ ({ id, kind: 1059, content: 'x', tags: [] });

  it('keeps events with no cached plaintext', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa'), wrap('bb')],
      cacheWith({}),
      () => false
    );
    expect(result.map((e) => e.id)).toEqual(['aa', 'bb']);
  });

  it('skips events whose plaintext is already in the cache', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa'), wrap('bb'), wrap('cc')],
      cacheWith({ bb: 'cached-plaintext' }),
      () => false
    );
    expect(result.map((e) => e.id)).toEqual(['aa', 'cc']);
  });

  // A gift wrap is a TWO-stage decrypt: wrap -> seal -> rumor, each stage
  // cached under its own event id. A hit on the wrap's id alone only proves
  // the seal was recovered, so skipping on it stranded wraps whose seal was
  // never opened — locked forever, no error raised, invisible in the thread
  // while other clients showed the message (laoc, 2026-09-18).
  const sealJson = (/** @type {string} */ id) =>
    JSON.stringify({ id, kind: 13, pubkey: 'author', content: 'ciphertext', tags: [] });

  it('keeps a gift wrap whose seal plaintext is missing from the cache', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa')],
      cacheWith({ aa: sealJson('seal-aa') }),
      () => false,
      giftWrapSealCacheKeys
    );
    expect(result.map((e) => e.id)).toEqual(['aa']);
  });

  it('skips a gift wrap only when both wrap and seal plaintext are cached', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa')],
      cacheWith({ aa: sealJson('seal-aa'), 'seal-aa': '{"kind":14,"content":"hi"}' }),
      () => false,
      giftWrapSealCacheKeys
    );
    expect(result).toEqual([]);
  });

  it('keeps a gift wrap whose cached plaintext is not a readable seal', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa'), wrap('bb')],
      cacheWith({ aa: 'not json at all', bb: '{"kind":13}' }),
      () => false,
      giftWrapSealCacheKeys
    );
    expect(result.map((e) => e.id)).toEqual(['aa', 'bb']);
  });

  it('skips events the unlocked-predicate already covers', async () => {
    const result = await filterEventsNeedingSignerUnlock(
      [wrap('aa'), wrap('bb')],
      cacheWith({}),
      (e) => e.id === 'aa'
    );
    expect(result.map((e) => e.id)).toEqual(['bb']);
  });

  it('treats cache read errors as cache misses', async () => {
    const throwingCache = {
      getItem: async () => {
        throw new Error('storage broken');
      },
      setItem: async () => {}
    };
    const result = await filterEventsNeedingSignerUnlock([wrap('aa')], throwingCache, () => false);
    expect(result.map((e) => e.id)).toEqual(['aa']);
  });
});
