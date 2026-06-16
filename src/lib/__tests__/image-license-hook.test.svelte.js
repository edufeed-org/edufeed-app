/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { EventStore } from 'applesauce-core';
import { useLicenseForHash, useLicenseStatus } from '$lib/stores/image-license.svelte.js';

// Hoisted mocks (vi.mock is hoisted; reference must be inside the factory)
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.example']
}));

const sharedStore = new EventStore();
// Test fixtures have fake ids/sigs and would fail nostr-tools' verifyEvent.
sharedStore.verifyEvent = () => true;
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  get eventStore() {
    return sharedStore;
  }
}));

/**
 * @param {string} hash
 * @param {number} createdAt
 * @param {string} [id]
 */
function makeLicenseEvent(hash, createdAt, id = 'a') {
  return {
    id: id.padEnd(64, '0'),
    pubkey: 'b'.repeat(64),
    kind: 1063,
    created_at: createdAt,
    content: '',
    tags: [
      ['url', `https://blossom.example/${hash}.jpg`],
      ['x', hash],
      ['m', 'image/jpeg'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane Doe']
    ],
    sig: 'c'.repeat(128)
  };
}

describe('useLicenseForHash', () => {
  beforeEach(() => {});

  it('returns null when no license event exists for the hash', () => {
    const hash = '1'.repeat(64);
    /** @type {() => any} */
    let getter = () => null;
    /** @type {() => void} */
    let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => hash);
    });
    flushSync();
    expect(getter()).toBeNull();
    cleanup();
  });

  it('returns the newest license event when present', () => {
    const hash = '2'.repeat(64);
    const older = makeLicenseEvent(hash, 1000, 'older');
    const newer = makeLicenseEvent(hash, 2000, 'newer');
    sharedStore.add(older);
    sharedStore.add(newer);

    /** @type {() => any} */
    let getter = () => null;
    /** @type {() => void} */
    let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => hash);
    });
    flushSync();
    expect(getter()?.id).toBe(newer.id);
    cleanup();
  });

  it('returns null when getHash returns null', () => {
    /** @type {() => any} */
    let getter = () => null;
    /** @type {() => void} */
    let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => null);
    });
    flushSync();
    expect(getter()).toBeNull();
    cleanup();
  });

  it('reacts when a new event for the hash arrives later', () => {
    const hash = '3'.repeat(64);
    /** @type {() => any} */
    let getter = () => null;
    /** @type {() => void} */
    let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => hash);
    });
    flushSync();
    expect(getter()).toBeNull();
    sharedStore.add(makeLicenseEvent(hash, 5000));
    flushSync();
    expect(getter()).not.toBeNull();
    cleanup();
  });
});

describe('useLicenseStatus', () => {
  it('is "missing" immediately when getHash returns null (no loader)', () => {
    vi.useFakeTimers();
    /** @type {() => any} */ let getter = () => null;
    /** @type {() => void} */ let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseStatus(() => null);
    });
    flushSync();
    expect(getter().status).toBe('missing');
    expect(getter().event).toBeNull();
    cleanup();
    vi.useRealTimers();
  });

  it('is "found" immediately when an event is already in the store', () => {
    const hash = '7'.repeat(64);
    // Unique id to avoid EventStore id-dedup collisions with other tests' events.
    sharedStore.add(makeLicenseEvent(hash, 1000, 'found7'));
    /** @type {() => any} */ let getter = () => null;
    /** @type {() => void} */ let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseStatus(() => hash);
    });
    flushSync();
    expect(getter().status).toBe('found');
    expect(getter().event?.id).toBeTruthy();
    cleanup();
  });

  it('stays "loading" before settle, then "missing" after the 2.5s timeout when store stays empty', () => {
    vi.useFakeTimers();
    const hash = '8'.repeat(64);
    /** @type {() => any} */ let getter = () => null;
    /** @type {() => void} */ let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseStatus(() => hash);
    });
    flushSync();
    expect(getter().status).toBe('loading');
    vi.advanceTimersByTime(2500);
    flushSync();
    expect(getter().status).toBe('missing');
    cleanup();
    vi.useRealTimers();
  });

  it('flips to "found" if an event arrives during the loading window', () => {
    vi.useFakeTimers();
    const hash = '9'.repeat(64);
    /** @type {() => any} */ let getter = () => null;
    /** @type {() => void} */ let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseStatus(() => hash);
    });
    flushSync();
    expect(getter().status).toBe('loading');
    // Unique id to avoid EventStore id-dedup collisions with other tests' events.
    sharedStore.add(makeLicenseEvent(hash, 5000, 'flip9'));
    flushSync();
    expect(getter().status).toBe('found');
    cleanup();
    vi.useRealTimers();
  });

  it('stays "found" (does not regress to "missing") if the store later emits empty', () => {
    const hash = 'a'.repeat(64);
    const event = makeLicenseEvent(hash, 1000, 'sticky');
    sharedStore.add(event);
    /** @type {() => any} */ let getter = () => null;
    /** @type {() => void} */ let cleanup = () => {};
    cleanup = $effect.root(() => {
      getter = useLicenseStatus(() => hash);
    });
    flushSync();
    expect(getter().status).toBe('found');
    // A later empty emission (e.g. the event removed from the store) must not
    // flip a found license back to a caution.
    sharedStore.remove(event);
    flushSync();
    expect(getter().status).toBe('found');
    cleanup();
  });
});
