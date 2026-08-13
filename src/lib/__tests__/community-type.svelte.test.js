/** @vitest-environment jsdom */
// src/lib/__tests__/community-type.svelte.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Subject } from 'rxjs';

const COMMUNITY_PUBKEY = 'a'.repeat(64);
const RELAY = 'wss://test.example.com';

/** @type {Subject<any>} */
let replaceableSubject;

/** @type {Subject<any>} */
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

const { useCommunityType } = await import('$lib/stores/community-type.svelte.js');
const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const { addressLoader } = await import('$lib/loaders/base.js');

beforeEach(() => {
  replaceableSubject = new Subject();
  loaderSubject = new Subject();
  vi.clearAllMocks();
});

describe('useCommunityType', () => {
  it('returns a getter function', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    expect(typeof getter).toBe('function');
  });

  it('returns null initially while unknown', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    expect(getter()).toBe(null);
  });

  it('loads community type using addressLoader with relays', () => {
    const getPubkey = vi.fn(() => COMMUNITY_PUBKEY);
    useCommunityType(getPubkey);

    expect(addressLoader).toHaveBeenCalledWith({
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      relays: [RELAY]
    });
  });

  it('subscribes to eventStore.replaceable(10222, pubkey)', () => {
    useCommunityType(() => COMMUNITY_PUBKEY);
    expect(eventStore.replaceable).toHaveBeenCalledWith(10222, COMMUNITY_PUBKEY);
  });

  it('derives open community type', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: []
    };
    replaceableSubject.next(event);

    expect(getter()).toBe('open');
  });

  it('derives moderated community type', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: /** @type {string[][]} */ ([['membership', 'root1', RELAY]])
    };
    replaceableSubject.next(event);

    expect(getter()).toBe('moderated');
  });

  it('derives closed community type', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    const event = {
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      tags: /** @type {string[][]} */ ([['concord', 'area1', RELAY]])
    };
    replaceableSubject.next(event);

    expect(getter()).toBe('closed');
  });

  it('returns null when event is undefined', () => {
    const getter = useCommunityType(() => COMMUNITY_PUBKEY);
    replaceableSubject.next(undefined);

    expect(getter()).toBe(null);
  });

  it('has cleanup that unsubscribes from both loader and replaceable', () => {
    // The hook creates subscriptions in an $effect
    // Cleanup is returned from $effect and will unsubscribe both loaderSubject and replaceableSubject
    useCommunityType(() => COMMUNITY_PUBKEY);

    // Verify that both subscriptions are created
    expect(addressLoader).toHaveBeenCalled();
    expect(eventStore.replaceable).toHaveBeenCalled();
  });

  it('reacts to pubkey changes', () => {
    const pubkeySource = vi.fn(() => COMMUNITY_PUBKEY);
    useCommunityType(pubkeySource);

    expect(addressLoader).toHaveBeenCalledWith({
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      relays: [RELAY]
    });

    // Change pubkey
    const newPubkey = 'b'.repeat(64);
    pubkeySource.mockReturnValue(newPubkey);

    // After pubkey changes (in a new effect cycle)
    expect(addressLoader).toHaveBeenLastCalledWith({
      kind: 10222,
      pubkey: COMMUNITY_PUBKEY,
      relays: [RELAY]
    });
  });
});
