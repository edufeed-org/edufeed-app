// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock $env/dynamic/private before importing the module under test
vi.mock('$env/dynamic/private', () => ({
  env: {
    CALENDAR_RELAYS: 'wss://cal-a.example.com,wss://cal-b.example.com',
    FALLBACK_RELAYS: 'wss://fallback.example.com'
  }
}));

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  parseRelays,
  getCalendarRelaysServer,
  safeHintRelays,
  decodeIdentifier,
  fetchEventFromRelays,
  fetchEventsFromRelays,
  dropDeletedEvents,
  deletionFiltersFor
} from '$lib/server/nostr-fetch.js';

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const OTHER_SK = generateSecretKey();

/**
 * A validly signed event — the fetchers reject anything whose signature does
 * not verify, so test fixtures must be real.
 * @param {{ kind: number, tags?: string[][], content?: string, created_at?: number }} t
 * @param {Uint8Array} [sk]
 */
function signed(t, sk = SK) {
  return finalizeEvent({ content: '', tags: [], created_at: 1_700_000_000, ...t }, sk);
}

/**
 * Minimal in-memory WebSocket stub that mirrors the subset of the `ws` API
 * the production code uses: `on('open' | 'message' | 'error', ...)`,
 * `send`, and `close`. Tests drive it via `__simulate*` helpers.
 */
class MockWebSocket {
  /**
   * @param {string} url
   */
  constructor(url) {
    this.url = url;
    /** @type {Record<string, Array<(...args: any[]) => void>>} */
    this._listeners = { open: [], message: [], error: [], close: [] };
    this.closed = false;
    /** @type {any[]} */
    this.sent = [];
    MockWebSocket.instances.push(this);
    // Auto-open on next microtask so production code can attach handlers first
    queueMicrotask(() => {
      if (!this.closed) this._emit('open');
    });
  }

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._emit('close');
  }

  _emit(event, ...args) {
    for (const fn of this._listeners[event] || []) fn(...args);
  }

  /**
   * Simulate the relay sending a Nostr message back. The `subId` is read out
   * of the request the production code sent so we don't have to hard-code it.
   * @param {[string, ...any[]]} message
   */
  emitMessage(message) {
    this._emit('message', Buffer.from(JSON.stringify(message)));
  }

  /** @returns {string | undefined} */
  reqSubId() {
    if (this.sent.length === 0) return undefined;
    try {
      const parsed = JSON.parse(this.sent[0]);
      return parsed[0] === 'REQ' ? parsed[1] : undefined;
    } catch {
      return undefined;
    }
  }
}
MockWebSocket.instances = [];

beforeEach(() => {
  MockWebSocket.instances = [];
});

/**
 * Wait for a microtask to flush so the auto-emitted "open" event is delivered
 * to the production code's handler.
 */
function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('parseRelays', () => {
  it('returns [] for undefined / empty string', () => {
    expect(parseRelays(undefined)).toEqual([]);
    expect(parseRelays('')).toEqual([]);
  });

  it('splits CSV, trims, drops empties', () => {
    expect(parseRelays('wss://a, wss://b,, wss://c ')).toEqual(['wss://a', 'wss://b', 'wss://c']);
  });
});

describe('getCalendarRelaysServer', () => {
  it('reads CALENDAR_RELAYS and FALLBACK_RELAYS from env, dedupes', () => {
    expect(getCalendarRelaysServer()).toEqual([
      'wss://cal-a.example.com',
      'wss://cal-b.example.com',
      'wss://fallback.example.com'
    ]);
  });

  it('puts configured relays before hint relays and dedupes', () => {
    const merged = getCalendarRelaysServer(['wss://hint.example.com', 'wss://cal-a.example.com']);
    expect(merged).toEqual([
      'wss://cal-a.example.com',
      'wss://cal-b.example.com',
      'wss://fallback.example.com',
      'wss://hint.example.com'
    ]);
  });
});

describe('safeHintRelays', () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  it('keeps public wss relays', async () => {
    expect(await safeHintRelays(['wss://relay.example.com'], publicLookup)).toEqual([
      'wss://relay.example.com'
    ]);
  });

  it('drops non-wss, private, loopback and unparsable relay URLs', async () => {
    const result = await safeHintRelays(
      [
        'ws://relay.example.com',
        'https://relay.example.com',
        'wss://localhost:7777',
        'wss://127.0.0.1',
        'wss://10.0.0.5',
        'wss://[::1]',
        'wss://printer.local',
        'not a url',
        42
      ],
      publicLookup
    );
    expect(result).toEqual([]);
  });

  it('drops a public-looking hostname that resolves to a private address', async () => {
    const privateLookup = async () => [{ address: '192.168.1.10', family: 4 }];
    expect(await safeHintRelays(['wss://evil.example.com'], privateLookup)).toEqual([]);
  });
});

describe('decodeIdentifier', () => {
  it('returns null for non-naddr/non-nevent strings', () => {
    expect(decodeIdentifier('not-an-identifier')).toBeNull();
    expect(decodeIdentifier('npub1abc')).toBeNull();
  });
});

describe('fetchEventFromRelays', () => {
  it('returns a verified event matching the filter', async () => {
    const ev = signed({ kind: 0, content: '{}' });
    const filter = { kinds: [0], authors: [PK], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://r1.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });

    await flushMicrotasks();
    await flushMicrotasks(); // give production code's open handler time to send REQ

    const ws = MockWebSocket.instances[0];
    expect(ws.reqSubId()).toBeTruthy();
    ws.emitMessage(['EVENT', ws.reqSubId(), ev]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);

    expect(JSON.parse(JSON.stringify(await promise))).toEqual(JSON.parse(JSON.stringify(ev)));
  });

  it('rejects a forged event (signature does not verify)', async () => {
    const real = signed({
      kind: 31924,
      tags: [
        ['d', 'cal'],
        ['title', 'Real']
      ]
    });
    const forged = {
      ...real,
      tags: [
        ['d', 'cal'],
        ['title', 'Forged']
      ]
    };
    const filter = { kinds: [31924], authors: [PK], '#d': ['cal'], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://evil.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0];
    ws.emitMessage(['EVENT', ws.reqSubId(), forged]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);
    expect(await promise).toBeNull();
  });

  it('rejects a validly signed event that does not match the filter', async () => {
    const wrongAuthor = signed({ kind: 31924, tags: [['d', 'cal']] }, OTHER_SK);
    const wrongD = signed({ kind: 31924, tags: [['d', 'other']] });
    const filter = { kinds: [31924], authors: [PK], '#d': ['cal'], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://evil.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0];
    ws.emitMessage(['EVENT', ws.reqSubId(), wrongAuthor]);
    ws.emitMessage(['EVENT', ws.reqSubId(), wrongD]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);
    expect(await promise).toBeNull();
  });

  it('waits for every relay and returns the newest revision (stale first arrival loses)', async () => {
    const stale = signed({
      kind: 31923,
      tags: [
        ['d', 'e'],
        ['title', 'Old']
      ],
      created_at: 100
    });
    const fresh = signed({
      kind: 31923,
      tags: [
        ['d', 'e'],
        ['title', 'New']
      ],
      created_at: 200
    });
    const filter = { kinds: [31923], authors: [PK], '#d': ['e'], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://r1.example.com', 'wss://r2.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const [ws1, ws2] = MockWebSocket.instances;
    ws1.emitMessage(['EVENT', ws1.reqSubId(), stale]);
    ws1.emitMessage(['EOSE', ws1.reqSubId()]);
    ws2.emitMessage(['EVENT', ws2.reqSubId(), fresh]);
    ws2.emitMessage(['EOSE', ws2.reqSubId()]);
    expect((await promise)?.id).toBe(fresh.id);
  });

  it('breaks a created_at tie by the lowest id (NIP-01)', async () => {
    const a = signed({
      kind: 31923,
      tags: [
        ['d', 'e'],
        ['title', 'A']
      ],
      created_at: 300
    });
    const b = signed({
      kind: 31923,
      tags: [
        ['d', 'e'],
        ['title', 'B']
      ],
      created_at: 300
    });
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const filter = { kinds: [31923], authors: [PK], '#d': ['e'], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://r1.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0];
    ws.emitMessage(['EVENT', ws.reqSubId(), high]);
    ws.emitMessage(['EVENT', ws.reqSubId(), low]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);
    expect((await promise)?.id).toBe(low.id);
  });

  it('resolves null on timeout when no relay returns a matching event', async () => {
    vi.useFakeTimers();
    try {
      const promise = fetchEventFromRelays({ ids: ['x'.repeat(64)] }, ['wss://r1.example.com'], {
        timeout: 100,
        WebSocket: MockWebSocket
      });
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;
      expect(result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchEventsFromRelays', () => {
  it('collects events across relays, dedupes by id, completes on EOSE-from-all', async () => {
    const filter = { kinds: [31923], '#h': ['comm'], limit: 100 };
    const e1 = signed({
      kind: 31923,
      tags: [
        ['d', '1'],
        ['h', 'comm']
      ]
    });
    const e2 = signed({
      kind: 31923,
      tags: [
        ['d', '2'],
        ['h', 'comm']
      ]
    });
    const promise = fetchEventsFromRelays(
      filter,
      ['wss://r1.example.com', 'wss://r2.example.com'],
      { timeout: 5000, WebSocket: MockWebSocket }
    );

    await flushMicrotasks();
    await flushMicrotasks();

    const [ws1, ws2] = MockWebSocket.instances;

    ws1.emitMessage(['EVENT', ws1.reqSubId(), e1]);
    ws1.emitMessage(['EVENT', ws1.reqSubId(), e2]); // duplicate via id-overlap on same socket
    ws2.emitMessage(['EVENT', ws2.reqSubId(), e2]); // duplicate via cross-relay
    ws1.emitMessage(['EOSE', ws1.reqSubId()]);
    ws2.emitMessage(['EOSE', ws2.reqSubId()]);

    const result = await promise;
    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual([e1.id, e2.id].sort());
  });

  it('resolves with collected events on overall timeout, even without EOSE', async () => {
    vi.useFakeTimers();
    try {
      const promise = fetchEventsFromRelays(
        { kinds: [31923], '#h': ['c'], limit: 100 },
        ['wss://r1.example.com'],
        { timeout: 200, WebSocket: MockWebSocket }
      );

      // Let the open handler run + REQ send
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      const ws = MockWebSocket.instances[0];
      const e = signed({
        kind: 31923,
        tags: [
          ['d', '3'],
          ['h', 'c']
        ]
      });
      ws.emitMessage(['EVENT', ws.reqSubId(), e]);

      // No EOSE — timeout should fire and resolve
      await vi.advanceTimersByTimeAsync(250);
      const result = await promise;
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(e.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns [] when given no relays', async () => {
    const result = await fetchEventsFromRelays({ kinds: [0] }, [], {
      timeout: 100,
      WebSocket: MockWebSocket
    });
    expect(result).toEqual([]);
  });
});

describe('fetchEventsFromRelays verification', () => {
  it('drops forged and non-matching events, keeps verified matches', async () => {
    const good = signed({
      kind: 31923,
      tags: [
        ['d', 'g'],
        ['h', 'comm']
      ]
    });
    const forged = {
      ...signed({
        kind: 31923,
        tags: [
          ['d', 'f'],
          ['h', 'comm']
        ]
      }),
      content: 'x'
    };
    const otherCommunity = signed({
      kind: 31923,
      tags: [
        ['d', 'o'],
        ['h', 'elsewhere']
      ]
    });
    const promise = fetchEventsFromRelays(
      { kinds: [31923], '#h': ['comm'], limit: 100 },
      ['wss://r1.example.com'],
      { timeout: 1000, WebSocket: MockWebSocket }
    );
    await flushMicrotasks();
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0];
    ws.emitMessage(['EVENT', ws.reqSubId(), forged]);
    ws.emitMessage(['EVENT', ws.reqSubId(), otherCommunity]);
    ws.emitMessage(['EVENT', ws.reqSubId(), { not: 'an event' }]);
    ws.emitMessage(['EVENT', ws.reqSubId(), good]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);
    expect((await promise).map((e) => e.id)).toEqual([good.id]);
  });

  it('sends every filter of a multi-filter request and accepts a match of any', async () => {
    const byA = signed({ kind: 5, tags: [['a', `31923:${PK}:x`]] });
    const byE = signed({ kind: 5, tags: [['e', 'f'.repeat(64)]] });
    const filters = [
      { kinds: [5], authors: [PK], '#a': [`31923:${PK}:x`] },
      { kinds: [5], authors: [PK], '#e': ['f'.repeat(64)] }
    ];
    const promise = fetchEventsFromRelays(filters, ['wss://r1.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });
    await flushMicrotasks();
    await flushMicrotasks();
    const ws = MockWebSocket.instances[0];
    const req = JSON.parse(ws.sent[0]);
    expect(req.slice(2)).toEqual(filters);
    ws.emitMessage(['EVENT', ws.reqSubId(), byA]);
    ws.emitMessage(['EVENT', ws.reqSubId(), byE]);
    ws.emitMessage(['EOSE', ws.reqSubId()]);
    expect((await promise).map((e) => e.id).sort()).toEqual([byA.id, byE.id].sort());
  });
});

describe('NIP-09 deletions', () => {
  const ev = signed({ kind: 31923, tags: [['d', 'evt']], created_at: 1000 });
  const coord = `31923:${PK}:evt`;

  it('builds #a and #e kind-5 filters for the authors', () => {
    const filters = deletionFiltersFor([ev]);
    expect(filters).toEqual([
      { kinds: [5], authors: [PK], '#a': [coord] },
      { kinds: [5], authors: [PK], '#e': [ev.id] }
    ]);
    expect(deletionFiltersFor([])).toEqual([]);
  });

  it('drops an event whose coordinate the author deleted at or after its created_at', () => {
    const del = signed({ kind: 5, tags: [['a', coord]], created_at: 1000 });
    expect(dropDeletedEvents([ev], [del])).toEqual([]);
  });

  it('keeps a revision published after the deletion', () => {
    const del = signed({ kind: 5, tags: [['a', coord]], created_at: 999 });
    expect(dropDeletedEvents([ev], [del])).toEqual([ev]);
  });

  it('drops an event deleted by id', () => {
    const del = signed({ kind: 5, tags: [['e', ev.id]], created_at: 1 });
    expect(dropDeletedEvents([ev], [del])).toEqual([]);
  });

  it('ignores deletions signed by someone else', () => {
    const byA = signed({ kind: 5, tags: [['a', coord]], created_at: 2000 }, OTHER_SK);
    const byE = signed({ kind: 5, tags: [['e', ev.id]], created_at: 2000 }, OTHER_SK);
    expect(dropDeletedEvents([ev], [byA, byE])).toEqual([ev]);
  });

  it('ignores non-kind-5 events passed as deletions', () => {
    const notDel = signed({ kind: 1, tags: [['a', coord]], created_at: 2000 });
    expect(dropDeletedEvents([ev], [notDel])).toEqual([ev]);
  });
});
