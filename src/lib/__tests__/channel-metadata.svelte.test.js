/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect.root is a Svelte rune, available in .svelte.test.js context */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { Subject, NEVER } from 'rxjs';

/** @type {{ info: Record<string, Subject<any>>, requests: any[] }} */
const holders = { info: {}, requests: [] };

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: (/** @type {string} */ url) => ({
      information$: (holders.info[url] ??= new Subject()),
      request: (/** @type {any} */ filter) => {
        holders.requests.push({ url, filter });
        return NEVER;
      }
    })
  }
}));

import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';

const RELAY = 'wss://groups.example/';
const KEY = 'ab'.repeat(32);
const pointers = [{ id: 'room-1', relay: RELAY }];

beforeEach(() => {
  holders.info = {};
  holders.requests = [];
  vi.useFakeTimers();
});

describe('useChannelMetadata', () => {
  it('settles with pointers present instead of re-running its own NIP-11 race forever', () => {
    let cleanup = () => {};
    expect(() => {
      cleanup = $effect.root(() => {
        useChannelMetadata(() => pointers);
      });
      flushSync();
    }).not.toThrow();
    cleanup();
  });

  it('asks for kind:39000 only once the relay key is known, pinned to that key', () => {
    const cleanup = $effect.root(() => {
      useChannelMetadata(() => pointers);
    });
    flushSync();
    // Not ready yet: NIP-11 has not answered and the race window is open.
    expect(holders.requests).toHaveLength(0);

    holders.info[RELAY].next({ pubkey: KEY });
    flushSync();
    expect(holders.requests).toHaveLength(1);
    expect(holders.requests[0].filter.authors).toEqual([KEY]);
    cleanup();
  });

  it('requests unpinned once the race window expires without a NIP-11 answer', () => {
    const cleanup = $effect.root(() => {
      useChannelMetadata(() => pointers);
    });
    flushSync();
    vi.advanceTimersByTime(2_100);
    flushSync();
    expect(holders.requests).toHaveLength(1);
    expect(holders.requests[0].filter.authors).toBeUndefined();
    cleanup();
  });
});
