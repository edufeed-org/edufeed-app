// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// Which relays useMyGroups asks for the kind-10009 groups list.
//
// laoc signed in with his own npub and the rail showed his communities but
// none of his groups, on the same screen. The two lists are the same SHAPE of
// thing — a user-owned replaceable list — and the communities store already
// asks a wider set for exactly this reason: "The follow set is a user-owned
// event that may only exist on their write relays, which may not overlap with
// app relays" (joined-communities-list.svelte.js). useMyGroups asked only
// runtimeConfig.fallbackRelays, so a 10009 living anywhere else is invisible
// and the rail silently reports "no groups" rather than "not found yet".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const ME = 'f'.repeat(64);

const holders = vi.hoisted(() => ({
  requestedRelays: /** @type {string[][]} */ ([]),
  writeRelays: /** @type {string[]} */ ([]),
  writeRelaysError: /** @type {Error | null} */ (null)
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return { fallbackRelays: ['wss://fallback.example'] };
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));

// Override ONE export: this module has many, and a bare factory would drop the
// rest (the loader chain reads getEventLoaderLookupRelays at import time).
vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAllLookupRelays: () => ['wss://lookup.example', 'wss://fallback.example']
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: () =>
    holders.writeRelaysError
      ? Promise.reject(holders.writeRelaysError)
      : Promise.resolve(holders.writeRelays)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({ subscribe: () => ({ unsubscribe() {} }) })
  },
  pool: {
    group: (/** @type {string[]} */ relays) => {
      holders.requestedRelays.push(relays);
      return {
        request: () => ({
          pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) })
        })
      };
    }
  }
}));

vi.mock('applesauce-relay/operators', () => ({ storeEvents: () => (x) => x }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
vi.mock('applesauce-common/helpers/groups', () => ({
  GROUPS_LIST_KIND: 10009,
  getPublicGroups: () => []
}));

import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';

function mountHook() {
  const cleanup = $effect.root(() => {
    useMyGroups();
  });
  flushSync();
  return cleanup;
}

/** Every relay asked across all pool.group() calls. */
const asked = () => [...new Set(holders.requestedRelays.flat())];

describe('useMyGroups relay set', () => {
  beforeEach(() => {
    holders.requestedRelays = [];
    holders.writeRelays = [];
    holders.writeRelaysError = null;
  });

  it('asks the lookup relays, not just the fallback list', () => {
    const cleanup = mountHook();
    expect(asked()).toContain('wss://lookup.example');
    cleanup();
  });

  it("also asks the user's own write relays, where a user-owned list may only live", async () => {
    holders.writeRelays = ['wss://mailbox.example'];
    const cleanup = mountHook();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(asked()).toContain('wss://mailbox.example');
    cleanup();
  });

  it('does not re-ask a write relay already in the lookup set', async () => {
    holders.writeRelays = ['wss://lookup.example'];
    const cleanup = mountHook();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(holders.requestedRelays).toHaveLength(1);
    cleanup();
  });

  it('still asks the lookup relays when the write-relay lookup fails', async () => {
    holders.writeRelaysError = new Error('mailbox lookup failed');
    const cleanup = mountHook();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(asked()).toContain('wss://lookup.example');
    cleanup();
  });
});
