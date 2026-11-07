/** @vitest-environment node */
// SSRF guard for relay hints on the OG/GEO/sitemap relay reads: hints come
// from naddr/nevent in public URLs (or from configured curated-set naddrs),
// so only public wss:// relays may be dialed, capped, after configured relays.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

vi.mock('$env/dynamic/private', () => ({
  env: {
    LONGFORM_CONTENT_RELAY: 'wss://long.example',
    FALLBACK_RELAYS: 'wss://fallback.example'
  }
}));

/** Every URL the server opened a WebSocket to, in order. */
const dialed = vi.hoisted(() => /** @type {string[]} */ ([]));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWebSocket extends EventEmitter {
    /** @param {string} url */
    constructor(url) {
      super();
      dialed.push(url);
      setTimeout(() => this.emit('open'), 1);
    }
    /** @param {string} raw */
    send(raw) {
      const [, sub] = JSON.parse(raw);
      setTimeout(() => this.emit('message', Buffer.from(JSON.stringify(['EOSE', sub]))), 1);
    }
    close() {
      this.emit('close');
    }
  }
  return { default: FakeWebSocket };
});

import { fetchEventResultFromRelays, getRelaysForKind } from '$lib/server/relay-fetch.js';
import { resolveAuthors } from '$lib/server/geo/curated-authors.js';

/** @type {import('$lib/server/httpUrl.js').DnsLookupAll} */
const lookup = async (hostname) => {
  if (hostname === 'rebind.example') return [{ address: '192.168.1.10', family: 4 }];
  return [{ address: '93.184.216.34', family: 4 }];
};

const PK = 'b'.repeat(64);
const HOSTILE = [
  'ws://localhost:7777',
  'wss://10.0.0.5',
  'wss://rebind.example',
  'wss://public-hint.example'
];

describe('relay-fetch hint relays (SSRF)', () => {
  beforeEach(() => {
    dialed.length = 0;
  });

  it('naddr: dials only the public wss hint, after the configured relays', async () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'x', relays: HOSTILE });
    await fetchEventResultFromRelays(naddr, { lookup });
    expect(dialed).toEqual([
      'wss://long.example',
      'wss://fallback.example',
      'wss://public-hint.example'
    ]);
  });

  it('nevent: dials only the public wss hint, after the configured relays', async () => {
    const nevent = nip19.neventEncode({ id: 'a'.repeat(64), relays: HOSTILE, kind: 30023 });
    await fetchEventResultFromRelays(nevent, { lookup });
    expect(dialed).toEqual([
      'wss://long.example',
      'wss://fallback.example',
      'wss://public-hint.example'
    ]);
  });

  it('caps the number of hint relays dialed', async () => {
    const relays = Array.from({ length: 10 }, (_, i) => `wss://hint${i}.example`);
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: 'x', relays });
    await fetchEventResultFromRelays(naddr, { lookup });
    expect(dialed.slice(0, 2)).toEqual(['wss://long.example', 'wss://fallback.example']);
    expect(dialed.length).toBeLessThanOrEqual(4);
  });

  it('getRelaysForKind puts configured relays before hints', () => {
    expect(getRelaysForKind(30023, ['wss://hint.example'])).toEqual([
      'wss://long.example',
      'wss://fallback.example',
      'wss://hint.example'
    ]);
  });

  it('curated sets: only public wss hints reach the fetcher', async () => {
    const set = nip19.naddrEncode({ kind: 30000, pubkey: PK, identifier: 'l', relays: HOSTILE });
    const fetchFirst = vi.fn(async () => ({ event: null, complete: true }));
    await resolveAuthors({ sets: [set], direct: [] }, [], fetchFirst, { lookup });
    const relays = /** @type {any} */ (fetchFirst.mock.calls[0])[1];
    expect(relays).toContain('wss://public-hint.example');
    for (const bad of HOSTILE.slice(0, 3)) expect(relays).not.toContain(bad);
  });
});
