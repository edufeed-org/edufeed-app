// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
/**
 * A user with no kind-10009 must not crash the groups sidebar.
 *
 * From laoc's console, repeated on every emission:
 *
 *   Uncaught TypeError: Reflect.has called on non-object
 *     at Object.next (unlinked-groups.svelte.js:65:16)
 *
 * `TimelineModel` emits `[]` while nothing has been found — which is the
 * normal state for anyone who has never saved a group, and the state on every
 * relay that does not carry the list. `events?.[0]` is then `undefined`, and
 * applesauce's `getPublicGroups` hands it straight to
 * `getOrComputeCachedValue`, which calls `Reflect.has(undefined, symbol)` and
 * throws. The `?? []` never runs, because the call threw before returning.
 *
 * getPublicGroups is deliberately NOT mocked here. The sibling test file stubs
 * it to `() => []`, and a stub like that cannot express this defect at all —
 * it returns cleanly for exactly the input that crashes in the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const ME = 'f'.repeat(64);

const holders = vi.hoisted(() => ({
  /** @type {(events: any[]) => void} */
  emit: () => {}
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return { fallbackRelays: ['wss://fallback.example'] };
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));

vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAllLookupRelays: () => ['wss://lookup.example']
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: () => Promise.resolve([])
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({
      subscribe: (/** @type {any} */ observer) => {
        const next = typeof observer === 'function' ? observer : observer.next;
        holders.emit = next;
        return { unsubscribe() {} };
      }
    })
  },
  pool: {
    group: () => ({
      request: () => ({ pipe: () => ({ subscribe: () => ({ unsubscribe() {} }) }) })
    })
  }
}));

vi.mock('applesauce-relay/operators', () => ({ storeEvents: () => (x) => x }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));

import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';

describe('useMyGroups with no groups list', () => {
  beforeEach(() => {
    holders.emit = () => {};
  });

  it('reports no groups instead of throwing when the timeline is empty', () => {
    let read;
    const cleanup = $effect.root(() => {
      const getGroups = useMyGroups();
      read = getGroups;
    });
    flushSync();
    // Exactly what TimelineModel emits for a user with no kind-10009.
    expect(() => holders.emit([])).not.toThrow();
    flushSync();
    expect(read()).toEqual([]);
    cleanup();
  });

  it('still reads a list that does arrive', () => {
    let read;
    const cleanup = $effect.root(() => {
      read = useMyGroups();
    });
    flushSync();
    holders.emit([
      {
        kind: 10009,
        tags: [['group', 'abc', 'wss://relay.example']],
        content: ''
      }
    ]);
    flushSync();
    expect(read()).toEqual([
      expect.objectContaining({ id: 'abc', relay: expect.stringContaining('relay.example') })
    ]);
    cleanup();
  });
});
