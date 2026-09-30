// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useAgentPresence: one standing kind-20001 subscription per groups relay for
// the pubkeys of interest. The subscription effect keeps known entries for
// pubkeys still of interest, which means it READS `presence` — it must do so
// untracked, or the write that follows re-triggers the effect forever
// (effect_update_depth_exceeded took the whole /c/agents route down).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const RELAY = 'wss://groups.example/';
const AGENT_A = 'a'.repeat(64);
const AGENT_B = 'b'.repeat(64);

const holders = vi.hoisted(() => ({
  subscriptionCalls: /** @type {any[]} */ ([]),
  /** @type {Record<string, any>} */
  liveByRelay: {}
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { Subject, merge, of } = await import('rxjs');
  return {
    eventStore: {},
    pool: {
      relay: (/** @type {string} */ url) => ({
        subscription: (/** @type {any} */ filter) => {
          holders.subscriptionCalls.push({ url, filter });
          const live = (holders.liveByRelay[url] ??= new Subject());
          return merge(of('EOSE'), live);
        }
      })
    }
  };
});
vi.mock('$lib/helpers/relay-helper.js', () => ({ getGroupsRelays: () => [RELAY] }));

import { useAgentPresence } from '$lib/agents/agent-presence.svelte.js';

/** @param {() => string[]} getPubkeys */
function mountHook(getPubkeys) {
  /** @type {() => any} */
  let get;
  const cleanup = $effect.root(() => {
    get = useAgentPresence(getPubkeys);
  });
  flushSync();
  return { get: () => get(), cleanup };
}

const presenceEvent = (pubkey, status, created_at) => ({
  kind: 20001,
  pubkey,
  created_at,
  id: `p-${pubkey.slice(0, 4)}-${created_at}`,
  sig: 'x',
  content: status,
  tags: []
});

beforeEach(() => {
  holders.subscriptionCalls.length = 0;
  holders.liveByRelay = {};
});

describe('useAgentPresence', () => {
  it('subscribes once per relay and does not re-trigger itself on its own writes', () => {
    const { get, cleanup } = mountHook(() => [AGENT_A]);
    expect(holders.subscriptionCalls).toHaveLength(1);
    expect(holders.subscriptionCalls[0].filter).toEqual({ kinds: [20001], authors: [AGENT_A] });

    holders.liveByRelay[RELAY].next(presenceEvent(AGENT_A, 'online', 1000));
    flushSync();
    expect(get().get(AGENT_A)).toEqual({ status: 'online', at: 1000 });
    // The write above must not have torn down and rebuilt the subscription.
    expect(holders.subscriptionCalls).toHaveLength(1);
    cleanup();
  });

  it('mounts cleanly with no pubkeys of interest', () => {
    const { get, cleanup } = mountHook(() => []);
    expect(holders.subscriptionCalls).toHaveLength(0);
    expect(get().size).toBe(0);
    cleanup();
  });

  it('keeps entries for pubkeys still of interest when the set changes', () => {
    let pubkeys = $state.raw([AGENT_A, AGENT_B]);
    const { get, cleanup } = mountHook(() => pubkeys);
    holders.liveByRelay[RELAY].next(presenceEvent(AGENT_A, 'online', 1000));
    holders.liveByRelay[RELAY].next(presenceEvent(AGENT_B, 'away', 1001));
    flushSync();
    expect(get().size).toBe(2);

    pubkeys = [AGENT_A];
    flushSync();
    expect(get().get(AGENT_A)).toEqual({ status: 'online', at: 1000 });
    expect(get().has(AGENT_B)).toBe(false);
    expect(holders.subscriptionCalls).toHaveLength(2);
    cleanup();
  });
});
