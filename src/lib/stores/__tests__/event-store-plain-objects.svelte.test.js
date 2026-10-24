// @ts-nocheck
/* eslint-disable no-undef -- runes are available in .svelte.js context */
/**
 * Events that passed through the shared EventStore are never deep-proxied
 * by Svelte's $state: applesauce memoizes on events with non-enumerable
 * symbol properties, which Svelte's proxy rejects (state_descriptors_fixed),
 * so the store marks every inserted event as a non-plain object — Svelte
 * only proxies objects whose prototype is Object.prototype or Array.prototype.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache';
import { getProfileContent } from 'applesauce-core/helpers';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { eventStore } from '../nostr-infrastructure.svelte.js';

// Real signatures: the store verifies before it inserts
const sk = generateSecretKey();
const A = getPublicKey(sk);
const profile = (created_at) =>
  finalizeEvent({ kind: 0, created_at, content: '{"name":"x"}', tags: [] }, sk);
const note = (content) => finalizeEvent({ kind: 1, created_at: 1, content, tags: [] }, sk);

describe('EventStore events in deep $state', () => {
  it('a stored event is handed back by identity from $state and still memoizes', () => {
    const stored = eventStore.add(note('stored'));
    let list = $state([]);
    list = [stored];
    expect(list[0]).toBe(stored);
    expect(getOrComputeCachedValue(list[0], Symbol('probe'), () => 42)).toBe(42);

    let holder = $state({ event: null });
    holder = { event: stored };
    expect(holder.event).toBe(stored);
  });

  it('a replaceable fetched back from the store is safe for the memoizing helpers', () => {
    eventStore.add(profile(1));
    const stored = eventStore.getReplaceable(0, A);
    let current = $state({ profile: null });
    current = { profile: stored };
    expect(getProfileContent(current.profile).name).toBe('x');
  });

  it('a plain object that never met the store is still proxied (the guard lives in the store)', () => {
    let list = $state([]);
    list = [note('never stored')];
    expect(() => getOrComputeCachedValue(list[0], Symbol('probe'), () => 1)).toThrow(
      /state_descriptors_fixed/
    );
  });
});
