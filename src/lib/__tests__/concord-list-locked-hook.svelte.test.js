// @ts-nocheck
/* eslint-disable no-undef -- $effect.root is a Svelte rune, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useConcordListLocked (Fix 2: unlock affordance) — mirrors
// applesauce-concord's own watchLists() reconcile chain: subscribing to the
// CAST's own communities$ (not just the outer communityList$) is what
// actually observes `.unlock()`'s notifyEventUpdate re-emission.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

const holders = vi.hoisted(() => ({ client: /** @type {any} */ (undefined) }));

vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordState: () => ({ communities: [] }),
  getConcordClient: () => holders.client
}));

import { useConcordListLocked } from '$lib/concord/unlinked-areas.svelte.js';

/** @param {boolean} unlocked */
function fakeCast(unlocked) {
  const cast = { unlocked, communities$: /** @type {any} */ (undefined) };
  cast.communities$ = new BehaviorSubject(unlocked ? [] : undefined);
  return cast;
}

/** Mounts the hook inside an effect root and flushes; returns {getLocked, cleanup}. */
function mountHook() {
  /** @type {() => boolean} */
  let getLocked;
  const cleanup = $effect.root(() => {
    getLocked = useConcordListLocked();
  });
  flushSync();
  return { getLocked, cleanup };
}

describe('useConcordListLocked', () => {
  beforeEach(() => {
    holders.client = undefined;
  });

  it('is false when there is no client', () => {
    const { getLocked, cleanup } = mountHook();
    expect(getLocked()).toBe(false);
    cleanup();
  });

  it('is false when the client has no community list cast yet', () => {
    holders.client = { communityList$: new BehaviorSubject(undefined) };
    const { getLocked, cleanup } = mountHook();
    expect(getLocked()).toBe(false);
    cleanup();
  });

  it('is true while the cast is present but not unlocked', () => {
    const cast = fakeCast(false);
    holders.client = { communityList$: new BehaviorSubject(cast) };
    const { getLocked, cleanup } = mountHook();
    expect(getLocked()).toBe(true);
    cleanup();
  });

  it('flips to false once the cast reports unlocked and re-emits communities$', () => {
    const cast = fakeCast(false);
    holders.client = { communityList$: new BehaviorSubject(cast) };
    const { getLocked, cleanup } = mountHook();
    expect(getLocked()).toBe(true);

    // Simulate unlock(): the cast caches decrypted content and its OWN
    // communities$ re-emits (notifyEventUpdate) — the outer communityList$
    // does not need to emit a new cast instance for this to be observed.
    cast.unlocked = true;
    cast.communities$.next([{ community_id: 'x' }]);
    flushSync();

    expect(getLocked()).toBe(false);
    cleanup();
  });
});
