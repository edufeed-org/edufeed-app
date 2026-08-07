// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// Regression + behavior tests for useUnlinkedConcordAreas (Concord follow-up
// 1 review):
//
// 1. No self-triggered infinite loop. The hook's $effect used to write
//    `communikeyEvents` ($state.raw) AND read it back inside the SAME
//    subscription callback (`[...communikeyEvents]`). eventStore.replaceable()
//    replays synchronously when the event is already cached, so that read ran
//    inside the effect's own tracking window and registered `communikeyEvents`
//    as a dependency of the effect that just wrote it — an infinite
//    self-triggered re-run (CLAUDE.md: "$state inside $effect causes
//    re-triggers"). Fix: accumulate into an effect-LOCAL plain array and
//    reassign the $state from that local array — never read the $state
//    itself inside the effect/callbacks.
// 2. Bounded proactive fetch: one addressLoader({kind:10222, pubkey, relays})
//    call per joined pubkey per session, deduped via a module-level Set, with
//    relays passed IN THE POINTER (CLAUDE.md's addressLoader rule).
// 3. Gated on the concord flag: no subscriptions/fetches at all when disabled.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

// Distinct per test (never reused) — `requestedPubkeys` inside the hook
// module is module-level state that outlives any single test, so sharing a
// pubkey across tests would make one test's dedup accounting leak into
// another's assertions.
const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const PUBKEY_C = 'c'.repeat(64);
const PUBKEY_D = 'd'.repeat(64);
const PUBKEY_E = 'e'.repeat(64);

const holders = vi.hoisted(() => ({
  enabled: true,
  joined: /** @type {string[]} */ (['a'.repeat(64)]),
  addressLoaderSpy: () => {}, // reassigned in beforeEach
  replaceableSpy: () => {}
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return { concord: { enabled: holders.enabled } };
  }
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => holders.joined
}));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordState: () => ({ communities: [] })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.example']
}));

// The loop-regression reproduction needs eventStore.replaceable() to emit
// SYNCHRONOUSLY on subscribe (as it does for cached events) — a
// BehaviorSubject does exactly that.
const communikeySubject = new BehaviorSubject({
  kind: 10222,
  pubkey: PUBKEY_A,
  tags: [],
  content: ''
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (/** @type {any[]} */ ...args) => {
      holders.replaceableSpy(...args);
      return communikeySubject;
    }
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: (/** @type {any} */ pointer) => {
    holders.addressLoaderSpy(pointer);
    return { subscribe: () => ({ unsubscribe() {} }) };
  }
}));

import { useUnlinkedConcordAreas } from '$lib/concord/unlinked-areas.svelte.js';

/** Mounts the hook inside an effect root and flushes; returns the cleanup fn. */
function mountHook() {
  let cleanup;
  cleanup = $effect.root(() => {
    useUnlinkedConcordAreas();
  });
  flushSync();
  return cleanup;
}

describe('useUnlinkedConcordAreas', () => {
  beforeEach(() => {
    holders.enabled = true;
    holders.joined = [PUBKEY_A];
    holders.addressLoaderSpy = vi.fn();
    holders.replaceableSpy = vi.fn();
  });

  it('settles without throwing effect_update_depth_exceeded when a joined community 10222 is already cached', () => {
    expect(() => {
      const cleanup = mountHook();
      cleanup();
    }).not.toThrow();
  });

  it('proactively fetches each joined pubkey once, with relays in the pointer', () => {
    holders.joined = [PUBKEY_B, PUBKEY_C];
    const cleanup = mountHook();

    expect(holders.addressLoaderSpy).toHaveBeenCalledTimes(2);
    expect(holders.addressLoaderSpy).toHaveBeenCalledWith({
      kind: 10222,
      pubkey: PUBKEY_B,
      relays: ['wss://relay.example']
    });
    expect(holders.addressLoaderSpy).toHaveBeenCalledWith({
      kind: 10222,
      pubkey: PUBKEY_C,
      relays: ['wss://relay.example']
    });
    cleanup();
  });

  it('does not re-fetch a pubkey already requested this session', () => {
    holders.joined = [PUBKEY_D];
    let cleanup = mountHook();
    cleanup();
    expect(holders.addressLoaderSpy).toHaveBeenCalledTimes(1);

    // A second mount (e.g. sidebar unmounted/remounted) must not re-fire the
    // one-shot fetch for the same pubkey — the reactive eventStore
    // subscription (re-created below) still fires again, that's fine.
    holders.addressLoaderSpy = vi.fn();
    cleanup = mountHook();
    expect(holders.addressLoaderSpy).not.toHaveBeenCalled();
    cleanup();
  });

  it('skips all subscriptions and fetches when the concord flag is off', () => {
    holders.enabled = false;
    holders.joined = [PUBKEY_E];
    const cleanup = mountHook();

    expect(holders.addressLoaderSpy).not.toHaveBeenCalled();
    expect(holders.replaceableSpy).not.toHaveBeenCalled();
    cleanup();
  });
});
