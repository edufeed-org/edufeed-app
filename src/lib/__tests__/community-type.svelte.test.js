// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

const COMMUNITY_PUBKEY = 'a'.repeat(64);
const RELAY = 'wss://test.example.com';

/** @type {BehaviorSubject<any>} */
let replaceableSubject;

/** @type {BehaviorSubject<any>} */
let loaderSubject;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: vi.fn(() => replaceableSubject)
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: vi.fn(() => loaderSubject)
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: vi.fn(() => [RELAY])
}));

vi.mock('$lib/groups/community-membership.js', () => ({
  deriveCommunityType: vi.fn((event) => {
    if (!event) return null;
    const tags = event.tags || [];
    const hasMembership = tags.some(
      (/** @type {any} */ t) => Array.isArray(t) && t[0] === 'membership'
    );
    const hasConcord = tags.some((/** @type {any} */ t) => Array.isArray(t) && t[0] === 'concord');

    if (hasMembership && hasConcord) return 'open';
    if (hasConcord) return 'closed';
    if (hasMembership) return 'moderated';
    return 'open';
  })
}));

describe('useCommunityType', () => {
  /** @type {typeof import('$lib/stores/community-type.svelte.js').useCommunityType} */
  let useCommunityType;

  /** @type {(() => void) | undefined} */
  let cleanup;

  beforeEach(async () => {
    replaceableSubject = new BehaviorSubject(undefined);
    loaderSubject = new BehaviorSubject(undefined);
    const mod = await import('$lib/stores/community-type.svelte.js');
    useCommunityType = mod.useCommunityType;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup?.();
  });

  it('returns a getter function', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });
    flushSync();

    expect(typeof getter).toBe('function');
  });

  it('returns null initially while unknown', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });
    flushSync();

    expect(getter()).toBe(null);
  });

  it('loads community type using addressLoader with correct pointer shape including relays', async () => {
    const { addressLoader: addressLoaderMock } = await import('$lib/loaders/base.js');
    cleanup = $effect.root(() => {
      useCommunityType(() => COMMUNITY_PUBKEY);
    });
    flushSync();

    expect(vi.mocked(addressLoaderMock)).toHaveBeenCalledWith({
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      relays: [RELAY]
    });
  });

  it('subscribes to eventStore.replaceable(10222, pubkey)', async () => {
    const { eventStore: eventStoreMock } = await import('$lib/stores/nostr-infrastructure.svelte');
    cleanup = $effect.root(() => {
      useCommunityType(() => COMMUNITY_PUBKEY);
    });
    flushSync();

    expect(vi.mocked(eventStoreMock.replaceable)).toHaveBeenCalledWith(10222, COMMUNITY_PUBKEY);
  });

  it('derives open community type from empty tags', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });

    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: []
    };
    replaceableSubject.next(event);
    flushSync();

    expect(getter()).toBe('open');
  });

  it('derives moderated community type from membership pointer', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });

    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: /** @type {string[][]} */ ([['membership', 'root1', RELAY]])
    };
    replaceableSubject.next(event);
    flushSync();

    expect(getter()).toBe('moderated');
  });

  it('derives closed community type from concord pointer', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });

    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: /** @type {string[][]} */ ([['concord', 'area1', RELAY]])
    };
    replaceableSubject.next(event);
    flushSync();

    expect(getter()).toBe('closed');
  });

  it('returns null when replaceable emits undefined', () => {
    let getter;
    cleanup = $effect.root(() => {
      getter = useCommunityType(() => COMMUNITY_PUBKEY);
    });

    replaceableSubject.next(undefined);
    flushSync();

    expect(getter()).toBe(null);
  });

  it('unsubscribes subscriptions on cleanup', () => {
    const loaderSub = { unsubscribe: vi.fn() };
    const replaceableSub = { unsubscribe: vi.fn() };

    // Replace the loaderSubject mock with one that tracks the subscription
    loaderSubject.subscribe = vi.fn(() => loaderSub);
    replaceableSubject.subscribe = vi.fn(() => replaceableSub);

    cleanup = $effect.root(() => {
      useCommunityType(() => COMMUNITY_PUBKEY);
    });
    flushSync();

    cleanup();

    expect(loaderSub.unsubscribe).toHaveBeenCalled();
    expect(replaceableSub.unsubscribe).toHaveBeenCalled();
  });
});
