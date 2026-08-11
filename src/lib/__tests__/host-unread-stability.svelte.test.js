// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useHostUnread must not reopen its relay subscription when the channel-id
// array changes IDENTITY without changing content.
//
// Live 0xchat run (1277 channels): every streaming metadata event recomputed
// host.rows, the flatMap produced a fresh ids array, and the unread effect
// tore down and reopened its REQ dozens of times — enough to exhaust the
// relay's subscription cap and starve every later REQ on the connection
// (which is what made "create channel" look like it failed while the group
// was really created).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const ME = 'f'.repeat(64);
const RELAY = 'wss://groups.example';

const holders = vi.hoisted(() => ({
  subscribeCalls: /** @type {any[]} */ ([])
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const { NEVER } = await import('rxjs');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  return {
    eventStore,
    pool: {
      relay: () => ({
        subscription: (/** @type {any} */ filters) => {
          holders.subscribeCalls.push(filters);
          return NEVER;
        }
      })
    }
  };
});
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));

import { useHostUnread, __resetHostUnreadSession } from '$lib/groups/host-unread.svelte.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

beforeEach(() => {
  __resetHostUnreadSession();
  holders.subscribeCalls = [];
  localStorage.clear();
});

describe('useHostUnread subscription stability', () => {
  it('subscribes once for same-content ids arrays, again when the set really changes', async () => {
    let ids = $state.raw(['allgemein', 'redesign']);
    const cleanup = $effect.root(() => {
      useHostUnread(
        () => RELAY,
        () => ids,
        () => null
      );
    });
    flushSync();
    await settle();
    expect(holders.subscribeCalls.length).toBe(1);

    // Fresh identity, same content — the streaming-recompute case.
    ids = ['allgemein', 'redesign'];
    flushSync();
    await settle();
    expect(holders.subscribeCalls.length).toBe(1);

    // Content actually changed: one new subscription (after the debounce).
    ids = ['allgemein', 'redesign', 'neu'];
    flushSync();
    await settle();
    expect(holders.subscribeCalls.length).toBe(2);
    expect([...holders.subscribeCalls[1][0]['#h']].sort()).toEqual([
      'allgemein',
      'neu',
      'redesign'
    ]);

    cleanup();
  });

  it('coalesces a burst of set changes into one subscription', async () => {
    let ids = $state.raw(['a']);
    const cleanup = $effect.root(() => {
      useHostUnread(
        () => RELAY,
        () => ids,
        () => null
      );
    });
    flushSync();
    // Burst BEFORE the debounce fires: b, then c arrive while settling.
    ids = ['a', 'b'];
    flushSync();
    ids = ['a', 'b', 'c'];
    flushSync();
    await settle();
    expect(holders.subscribeCalls.length).toBe(1);
    expect([...holders.subscribeCalls[0][0]['#h']].sort()).toEqual(['a', 'b', 'c']);

    cleanup();
  });
});
