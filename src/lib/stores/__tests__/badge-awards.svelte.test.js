// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/**
 * Regression test: the kind 10008 profile_badges pointer must NOT carry an
 * identifier. Kind 10008 is a plain replaceable event (NIP-58) with no d tag;
 * an identifier on the pointer makes applesauce's address loader add
 * #d:["profile_badges"] to the BATCHED replaceable filter, which silently
 * blocks every other replaceable kind in the same batch (10015 interests,
 * 10050 DM relays, 10222 communities) from loading on profile pages.
 * Only the deprecated kind 30008 form uses d=profile_badges.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

const addressLoaderMock = vi.fn();
const replaceableMock = vi.fn();

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: (...args) => addressLoaderMock(...args),
  eventLoader: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    event: vi.fn(() => new Subject()),
    replaceable: (...args) => replaceableMock(...args)
  }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.test']
}));

const { useProfileBadges } = await import('../badge-awards.svelte.js');

const PUBKEY = 'a'.repeat(64);

describe('useProfileBadges pointer contract', () => {
  beforeEach(() => {
    addressLoaderMock.mockReset();
    replaceableMock.mockReset();
    addressLoaderMock.mockImplementation(() => ({
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }));
    replaceableMock.mockImplementation(() => new Subject());
  });

  it('loads kind 10008 without an identifier and legacy 30008 with d=profile_badges', () => {
    const cleanup = $effect.root(() => {
      useProfileBadges(() => PUBKEY);
    });
    flushSync();

    const pointers = addressLoaderMock.mock.calls.map(([pointer]) => pointer);
    const newPointer = pointers.find((p) => p.kind === 10008);
    const legacyPointer = pointers.find((p) => p.kind === 30008);

    expect(newPointer).toBeDefined();
    expect(newPointer.pubkey).toBe(PUBKEY);
    expect('identifier' in newPointer).toBe(false);

    expect(legacyPointer).toBeDefined();
    expect(legacyPointer.identifier).toBe('profile_badges');

    cleanup();
  });

  it('subscribes the store model for 10008 without an identifier', () => {
    const cleanup = $effect.root(() => {
      useProfileBadges(() => PUBKEY);
    });
    flushSync();

    const calls = replaceableMock.mock.calls;
    const newCall = calls.find(([kind]) => kind === 10008);
    const legacyCall = calls.find(([kind]) => kind === 30008);

    expect(newCall).toBeDefined();
    expect(newCall[1]).toBe(PUBKEY);
    expect(newCall[2]).toBeUndefined();

    expect(legacyCall).toBeDefined();
    expect(legacyCall[2]).toBe('profile_badges');

    cleanup();
  });
});
