// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useMyGroupPointers must not leak one account's roster into the next: a
// DIRECT A→B switch re-runs the effect with the new pubkey but (bug) never
// cleared `pointers`, so B's share picker offered A's communities. applesauce
// setActive emits no null in between, so the `if (!pubkey)` reset never fires.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const PUB_A = 'a'.repeat(64);
const PUB_B = 'b'.repeat(64);
const RELAY = 'wss://groups.example/';

const holders = vi.hoisted(() => ({
  /** @type {() => any} */ getActive: () => null,
  /** @type {Record<string, any[]>} */ byPubkey: {}
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => holders.getActive()
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getGroupsRelays: () => [RELAY]
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { scheduled, asyncScheduler } = await import('rxjs');
  return {
    eventStore: {},
    pool: {
      relay: () => ({
        // Async emission, like a real relay — a synchronous emit would run
        // inside the effect and get falsely tracked as a dependency.
        request: (/** @type {any} */ filter) =>
          scheduled(holders.byPubkey[filter['#p'][0]] ?? [], asyncScheduler)
      })
    }
  };
});

vi.mock('applesauce-relay/operators', () => ({ storeEvents: () => (/** @type {any} */ x) => x }));

import { useMyGroupPointers } from '$lib/groups/my-groups.svelte.js';

/** @param {string} id @param {string} member */
const rosterEvent = (id, member) => ({
  kind: 39002,
  pubkey: '9'.repeat(64),
  created_at: 1000,
  id: `roster-${id}`,
  sig: 'x',
  content: '',
  tags: [
    ['d', id],
    ['p', member]
  ]
});

describe('useMyGroupPointers — account switch', () => {
  beforeEach(() => {
    holders.byPubkey = {
      [PUB_A]: [rosterEvent('group-of-a', PUB_A)],
      [PUB_B]: [rosterEvent('group-of-b', PUB_B)]
    };
  });

  it('replaces the previous account’s pointers on a direct A→B switch', async () => {
    let activePubkey = $state(PUB_A);
    holders.getActive = () => (activePubkey ? { pubkey: activePubkey } : null);

    /** @type {() => Array<{id: string, relay: string}>} */
    let getPointers;
    const cleanup = $effect.root(() => {
      getPointers = useMyGroupPointers();
    });
    flushSync();
    await new Promise((r) => setTimeout(r, 20));
    expect(getPointers().map((p) => p.id)).toEqual(['group-of-a']);

    activePubkey = PUB_B; // direct switch — no null in between
    flushSync();
    await new Promise((r) => setTimeout(r, 20));

    expect(getPointers().map((p) => p.id)).toEqual(['group-of-b']);
    cleanup();
  });
});
