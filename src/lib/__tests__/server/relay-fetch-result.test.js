/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('nostr-tools/pure', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  verifyEvent: () => true
}));

/**
 * Scripted relays: url → 'eose' (answers, no match) | 'event' (answers with
 * the event) | 'hang' (never answers) | 'error' (connection fails).
 * @type {Record<string, string>}
 */
const script = vi.hoisted(() => ({}));
const EVENT = vi.hoisted(() => ({
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 30023,
  created_at: 1,
  tags: [['d', 'x']],
  content: '',
  sig: ''
}));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWebSocket extends EventEmitter {
    /** @param {string} url */
    constructor(url) {
      super();
      this.url = url;
      setTimeout(() => {
        const mode = script[url];
        if (mode === 'error') return this.emit('error', new Error('refused'));
        this.emit('open');
      }, 1);
    }
    /** @param {string} raw */
    send(raw) {
      const [, sub] = JSON.parse(raw);
      const mode = script[this.url];
      setTimeout(() => {
        if (mode === 'event')
          this.emit('message', Buffer.from(JSON.stringify(['EVENT', sub, EVENT])));
        if (mode === 'event' || mode === 'eose')
          this.emit('message', Buffer.from(JSON.stringify(['EOSE', sub])));
      }, 1);
    }
    close() {
      this.emit('close');
    }
  }
  return { default: FakeWebSocket };
});

import { fetchFirstEventResult, fetchFirstEvent } from '$lib/server/relay-fetch.js';

const filter = { kinds: [30023], authors: ['b'.repeat(64)], '#d': ['x'], limit: 1 };

describe('fetchFirstEventResult', () => {
  beforeEach(() => {
    for (const k of Object.keys(script)) delete script[k];
  });

  it('returns the event as soon as a relay delivers it', async () => {
    script['wss://a'] = 'hang';
    script['wss://b'] = 'event';
    expect(await fetchFirstEventResult(filter, ['wss://a', 'wss://b'], 2000)).toEqual({
      event: EVENT,
      complete: true
    });
  });

  it('reports a confirmed miss early when every relay answered without it', async () => {
    script['wss://a'] = 'eose';
    script['wss://b'] = 'eose';
    const t0 = Date.now();
    const res = await fetchFirstEventResult(filter, ['wss://a', 'wss://b'], 2000);
    expect(res).toEqual({ event: null, complete: true });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('reports an incomplete miss when a relay never answered (timeout)', async () => {
    script['wss://a'] = 'eose';
    script['wss://b'] = 'hang';
    expect(await fetchFirstEventResult(filter, ['wss://a', 'wss://b'], 100)).toEqual({
      event: null,
      complete: false
    });
  });

  it('does not count failed connections as a confirmed miss', async () => {
    script['wss://a'] = 'error';
    script['wss://b'] = 'error';
    expect(await fetchFirstEventResult(filter, ['wss://a', 'wss://b'], 100)).toEqual({
      event: null,
      complete: false
    });
  });

  it('counts a miss as confirmed when the other relays failed but one answered', async () => {
    script['wss://a'] = 'error';
    script['wss://b'] = 'eose';
    expect(await fetchFirstEventResult(filter, ['wss://a', 'wss://b'], 2000)).toEqual({
      event: null,
      complete: true
    });
  });

  it('keeps fetchFirstEvent returning just the event', async () => {
    script['wss://a'] = 'event';
    expect(await fetchFirstEvent(filter, ['wss://a'], 2000)).toEqual(EVENT);
    script['wss://a'] = 'eose';
    expect(await fetchFirstEvent(filter, ['wss://a'], 2000)).toBeNull();
  });
});
