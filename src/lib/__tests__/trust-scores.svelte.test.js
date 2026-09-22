// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useTrustScores(getPubkeys) — reactive Map of NIP-85 scores for the pubkeys
 * on screen. Mirrors useProfileMap's shape (a getter returning a Map) so
 * ContactSearchInput can read it during render, and useAuthorDeletions's
 * ask-once discipline so a list rebuilt on every keystroke never re-REQs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const cache = vi.hoisted(() => ({
  scores: new Map(),
  requested: /** @type {string[][]} */ ([]),
  updates: /** @type {any} */ (null)
}));

vi.mock('$lib/loaders/trust-assertions.js', () => ({
  requestTrustScores: vi.fn((pubkeys) => cache.requested.push([...pubkeys])),
  getTrustScore: (pk) => cache.scores.get(pk),
  get trustScoreUpdates() {
    return cache.updates;
  }
}));

describe('useTrustScores', () => {
  /** @type {any} */
  let useTrustScores;
  /** @type {(() => void) | undefined} */
  let cleanup;

  beforeEach(async () => {
    cache.scores = new Map();
    cache.requested = [];
    cache.updates = new Subject();
    // No vi.resetModules(): it would hand the hook a second Svelte runtime,
    // and $effect.root from this file could no longer own its effects.
    ({ useTrustScores } = await import('$lib/stores/trust-scores.svelte.js'));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('requests scores for the given pubkeys and exposes cached ones immediately', () => {
    cache.scores.set(A, { pubkey: A, rank: 94, hops: 2 });
    let get;
    cleanup = $effect.root(() => {
      get = useTrustScores(() => [A, B]);
    });
    flushSync();
    expect(cache.requested).toEqual([[A, B]]);
    expect(get().get(A)).toMatchObject({ rank: 94 });
    expect(get().has(B)).toBe(false);
  });

  it('re-renders when a score for a listed pubkey arrives later, ignoring unrelated subjects', () => {
    let get;
    cleanup = $effect.root(() => {
      get = useTrustScores(() => [A]);
    });
    flushSync();
    const before = get();
    cache.scores.set(B, { pubkey: B, rank: 1 });
    cache.updates.next(B);
    flushSync();
    expect(get()).toBe(before);

    cache.scores.set(A, { pubkey: A, rank: 40, hops: 3 });
    cache.updates.next(A);
    flushSync();
    expect(get()).not.toBe(before);
    expect(get().get(A)).toMatchObject({ rank: 40, hops: 3 });
  });

  // Ask-once dedupe lives in requestTrustScores (trust-assertions.test.js);
  // the hook just forwards whatever is on screen.
  it('follows the pubkey list reactively and drops scores for pubkeys that left', () => {
    let pubkeys = $state.raw([A]);
    let get;
    cleanup = $effect.root(() => {
      get = useTrustScores(() => pubkeys);
    });
    flushSync();
    pubkeys = [A, B];
    flushSync();
    expect(cache.requested).toEqual([[A], [A, B]]);
    pubkeys = [B];
    cache.scores.set(A, { pubkey: A, rank: 9 });
    cache.updates.next(A);
    flushSync();
    expect(get().has(A)).toBe(false);
  });

  // Regression: a fresh Map per pass looped with ContactSearchInput's
  // re-sort effect (rows → pubkeys → snapshot → rows …) and froze the list.
  it('keeps the same Map instance while the scores for the listed pubkeys are unchanged', () => {
    cache.scores.set(A, { pubkey: A, rank: 94 });
    let pubkeys = $state.raw([A]);
    let get;
    cleanup = $effect.root(() => {
      get = useTrustScores(() => pubkeys);
    });
    flushSync();
    const first = get();
    pubkeys = [A, B]; // list changed, but no score for B yet
    flushSync();
    expect(get()).toBe(first);
    cache.updates.next(A); // update for an unchanged score object
    flushSync();
    expect(get()).toBe(first);
  });

  it('stops listening for updates on teardown', () => {
    cleanup = $effect.root(() => {
      useTrustScores(() => [A]);
    });
    flushSync();
    expect(cache.updates.observed).toBe(true);
    cleanup();
    cleanup = undefined;
    expect(cache.updates.observed).toBe(false);
  });
});
