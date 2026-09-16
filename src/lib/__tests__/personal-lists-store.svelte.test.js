// @ts-nocheck
/* eslint-disable no-undef -- $derived/$effect are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * The Lists tab of "Meine Inhalte" died with `state_unsafe_mutation` for any
 * account that has a contact list (issue 6a4ac555, 2026-09-16).
 *
 * `personal-lists.svelte.js` held its singleton list events in a deep
 * `$state({})`, so every event handed out by `useList()` was a Svelte proxy.
 * applesauce's list helpers (`getProfilePointersFromList` & co.) memoize their
 * result by writing a Symbol onto the event on EVERY call — through the proxy
 * that becomes a state write, and inside a template `$derived` Svelte throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';
import { getProfilePointersFromList } from 'applesauce-common/helpers';

const ME = 'f'.repeat(64);
const OTHER = 'a'.repeat(64);

const doubles = vi.hoisted(() => ({
  active$: /** @type {any} */ (null),
  /** @type {Map<number, any>} */
  replaceables: new Map(),
  timeline$: /** @type {any} */ (null)
}));

// One shared active$ for the whole file: the store subscribes to it once at
// module load. (No vi.resetModules() — that would hand the store a second
// copy of the Svelte runtime, disconnected from the runes in this file.)
vi.mock('$lib/stores/accounts.svelte', async () => {
  const { Subject } = await import('rxjs');
  doubles.active$ = new Subject();
  return { manager: { active$: doubles.active$ } };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (kind) => {
      if (!doubles.replaceables.has(kind)) doubles.replaceables.set(kind, new Subject());
      return doubles.replaceables.get(kind);
    },
    model: () => doubles.timeline$
  }
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: async () => []
}));
vi.mock('$lib/loaders/base.js', () => ({ timedPool: vi.fn() }));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => new Subject()
}));

import { useList } from '$lib/stores/personal-lists.svelte.js';

/** @param {string[][]} tags */
const contacts = (tags) => ({
  id: 'k3-' + Math.random().toString(16).slice(2),
  kind: 3,
  pubkey: ME,
  created_at: 1,
  sig: 'x',
  content: '',
  tags
});

describe('personal-lists store', () => {
  /** @type {(() => void) | undefined} */
  let cleanup;

  beforeEach(() => {
    // Every user emission tears the store's subscriptions down and resets
    // its state, so a fresh set of EventStore doubles per test is enough.
    doubles.replaceables = new Map();
    doubles.timeline$ = new Subject();
    doubles.active$.next({ pubkey: ME });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('hands out the very event object the EventStore emitted (no reactive proxy)', () => {
    const event = contacts([['p', OTHER]]);
    doubles.replaceables.get(3).next(event);
    expect(useList(3)()).toBe(event);
  });

  it('lets applesauce list helpers memoize on a singleton inside a $derived', () => {
    const getContacts = useList(3);
    /** @type {any} */
    let pointers;
    cleanup = $effect.root(() => {
      const derived = $derived.by(() => {
        const list = getContacts();
        return list ? getProfilePointersFromList(list) : [];
      });
      $effect(() => {
        pointers = derived;
      });
    });
    flushSync();
    expect(pointers).toEqual([]);

    doubles.replaceables.get(3).next(contacts([['p', OTHER]]));
    expect(() => flushSync()).not.toThrow();
    expect(pointers.map((p) => p.pubkey)).toEqual([OTHER]);
  });
});
