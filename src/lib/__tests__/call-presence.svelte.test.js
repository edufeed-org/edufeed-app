/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect.root is a Svelte rune, available in .svelte.test.js context */
/**
 * useCallPresence — live kind-39004 ("who is in the AV room") for one
 * group, pinned to the relay's NIP-11 key the same way kind-39000 is
 * (channel-metadata.svelte.js): no request until the key race settles,
 * pinned once the key is known, unpinned only after the window expires with
 * no NIP-11 answer, and a forged event never counted even if it slips past
 * the REQ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { Subject } from 'rxjs';

/** @type {{ info: Record<string, Subject<any>>, subs: Array<{url: string, filters: any[], stream: Subject<any>, unsubscribed: boolean}> }} */
const holders = { info: {}, subs: [] };

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    relay: (/** @type {string} */ url) => ({
      information$: (holders.info[url] ??= new Subject()),
      subscription: (/** @type {any[]} */ filters) => {
        const stream = new Subject();
        const entry = { url, filters, stream, unsubscribed: false };
        holders.subs.push(entry);
        return {
          subscribe: (/** @type {any} */ handlers) => {
            const sub = stream.subscribe(handlers);
            return {
              unsubscribe: () => {
                entry.unsubscribed = true;
                sub.unsubscribe();
              }
            };
          }
        };
      }
    })
  }
}));

import { useCallPresence } from '$lib/groups/call-presence.svelte.js';

const RELAY = 'wss://groups.example/';
const KEY = 'ab'.repeat(32);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const pointer = { id: 'room-1', relay: RELAY };

/** @param {string} signer @param {string[]} participants @param {number} createdAt */
function presence(signer, participants, createdAt) {
  return {
    kind: 39004,
    pubkey: signer,
    created_at: createdAt,
    tags: [['d', 'room-1'], ...participants.map((p) => ['participant', p])]
  };
}

beforeEach(() => {
  holders.info = {};
  holders.subs = [];
  vi.useFakeTimers();
});

describe('useCallPresence', () => {
  it('opens nothing while the pointer getter returns null', () => {
    const cleanup = $effect.root(() => {
      useCallPresence(() => null);
    });
    flushSync();
    vi.advanceTimersByTime(2_100);
    flushSync();
    expect(holders.subs).toHaveLength(0);
    cleanup();
  });

  it('subscribes only once the relay key is known, pinned to that key', () => {
    let read = () => ({ participants: [], answered: false });
    const cleanup = $effect.root(() => {
      read = useCallPresence(() => pointer);
    });
    flushSync();
    expect(holders.subs).toHaveLength(0);
    expect(read().answered).toBe(false);

    holders.info[RELAY].next({ self: KEY });
    flushSync();
    expect(holders.subs).toHaveLength(1);
    expect(holders.subs[0].filters).toEqual([{ kinds: [39004], '#d': ['room-1'], authors: [KEY] }]);
    cleanup();
  });

  it('subscribes unpinned once the race window expires without a NIP-11 answer', () => {
    const cleanup = $effect.root(() => {
      useCallPresence(() => pointer);
    });
    flushSync();
    vi.advanceTimersByTime(2_100);
    flushSync();
    expect(holders.subs).toHaveLength(1);
    expect(holders.subs[0].filters[0].authors).toBeUndefined();
    cleanup();
  });

  it('counts a relay-signed 39004 and ignores a forged one, then marks answered on EOSE', () => {
    let read = () => ({ participants: /** @type {string[]} */ ([]), answered: false });
    const cleanup = $effect.root(() => {
      read = useCallPresence(() => pointer);
    });
    flushSync();
    holders.info[RELAY].next({ self: KEY });
    flushSync();
    const { stream } = holders.subs[0];

    stream.next(presence('f'.repeat(64), [A, B], 100));
    flushSync();
    expect(read().participants).toEqual([]);

    stream.next(presence(KEY, [A], 100));
    flushSync();
    expect(read().participants).toEqual([A]);
    expect(read().answered).toBe(false);

    stream.next('EOSE');
    flushSync();
    expect(read().answered).toBe(true);
    cleanup();
  });

  it('keeps only the newest event: a later one replaces, an older one is ignored', () => {
    let read = () => ({ participants: /** @type {string[]} */ ([]), answered: false });
    const cleanup = $effect.root(() => {
      read = useCallPresence(() => pointer);
    });
    flushSync();
    holders.info[RELAY].next({ self: KEY });
    flushSync();
    const { stream } = holders.subs[0];

    stream.next(presence(KEY, [A], 200));
    stream.next(presence(KEY, [A, B], 300));
    flushSync();
    expect(read().participants).toEqual([A, B]);

    stream.next(presence(KEY, [], 250));
    flushSync();
    expect(read().participants).toEqual([A, B]);

    stream.next(presence(KEY, [], 400));
    flushSync();
    expect(read().participants).toEqual([]);
    cleanup();
  });

  it('tears the subscription down and clears state when the pointer goes away', () => {
    let current = $state.raw(/** @type {any} */ (pointer));
    let read = () => ({ participants: /** @type {string[]} */ ([]), answered: false });
    const cleanup = $effect.root(() => {
      read = useCallPresence(() => current);
    });
    flushSync();
    holders.info[RELAY].next({ self: KEY });
    flushSync();
    holders.subs[0].stream.next(presence(KEY, [A], 100));
    flushSync();
    expect(read().participants).toEqual([A]);

    current = null;
    flushSync();
    expect(holders.subs[0].unsubscribed).toBe(true);
    expect(read().participants).toEqual([]);
    cleanup();
  });
});
