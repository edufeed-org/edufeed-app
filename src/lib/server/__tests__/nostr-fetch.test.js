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

import {
  parseRelays,
  getCalendarRelaysServer,
  decodeIdentifier,
  fetchEventFromRelays,
  fetchEventsFromRelays
} from '$lib/server/nostr-fetch.js';

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

  it('merges hint relays first and dedupes', () => {
    const merged = getCalendarRelaysServer(['wss://hint.example.com', 'wss://cal-a.example.com']);
    expect(merged[0]).toBe('wss://hint.example.com');
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged).toContain('wss://fallback.example.com');
  });
});

describe('decodeIdentifier', () => {
  it('returns null for non-naddr/non-nevent strings', () => {
    expect(decodeIdentifier('not-an-identifier')).toBeNull();
    expect(decodeIdentifier('npub1abc')).toBeNull();
  });
});

describe('fetchEventFromRelays', () => {
  it('returns the first matching event from any relay', async () => {
    const filter = { kinds: [0], authors: ['deadbeef'], limit: 1 };
    const promise = fetchEventFromRelays(filter, ['wss://r1.example.com', 'wss://r2.example.com'], {
      timeout: 1000,
      WebSocket: MockWebSocket
    });

    await flushMicrotasks();
    await flushMicrotasks(); // give production code's open handler time to send REQ

    const ws = MockWebSocket.instances[0];
    expect(ws.reqSubId()).toBeTruthy();
    const stubEvent = {
      id: 'a'.repeat(64),
      kind: 0,
      content: '{}',
      tags: [],
      pubkey: 'x',
      created_at: 1,
      sig: 's'
    };
    ws.emitMessage(['EVENT', ws.reqSubId(), stubEvent]);

    const result = await promise;
    expect(result).toEqual(stubEvent);
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
    const promise = fetchEventsFromRelays(
      filter,
      ['wss://r1.example.com', 'wss://r2.example.com'],
      { timeout: 5000, WebSocket: MockWebSocket }
    );

    await flushMicrotasks();
    await flushMicrotasks();

    const [ws1, ws2] = MockWebSocket.instances;
    const e1 = {
      id: '1'.padEnd(64, '1'),
      kind: 31923,
      content: '',
      tags: [],
      pubkey: 'a',
      created_at: 1,
      sig: 's'
    };
    const e2 = {
      id: '2'.padEnd(64, '2'),
      kind: 31923,
      content: '',
      tags: [],
      pubkey: 'b',
      created_at: 2,
      sig: 's'
    };

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
      const e = {
        id: '3'.padEnd(64, '3'),
        kind: 31923,
        content: '',
        tags: [],
        pubkey: 'c',
        created_at: 3,
        sig: 's'
      };
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
