/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { EventStore } from 'applesauce-core';
import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';

// Hoisted mocks (vi.mock is hoisted; reference must be inside the factory)
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://relay.example']
}));

const sharedStore = new EventStore();
// Test fixtures have fake ids/sigs and would fail nostr-tools' verifyEvent.
sharedStore.verifyEvent = () => true;
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  get eventStore() {
    return sharedStore;
  }
}));

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
  beforeEach(() => {
    sharedStore.database?.clear?.();
  });

  it('returns null when no license event exists for the hash', () => {
    const hash = '1'.repeat(64);
    let getter;
    const cleanup = $effect.root(() => {
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

    let getter;
    const cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => hash);
    });
    flushSync();
    expect(getter()?.id).toBe(newer.id);
    cleanup();
  });

  it('returns null when getHash returns null', () => {
    let getter;
    const cleanup = $effect.root(() => {
      getter = useLicenseForHash(() => null);
    });
    flushSync();
    expect(getter()).toBeNull();
    cleanup();
  });

  it('reacts when a new event for the hash arrives later', () => {
    const hash = '3'.repeat(64);
    let getter;
    const cleanup = $effect.root(() => {
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
