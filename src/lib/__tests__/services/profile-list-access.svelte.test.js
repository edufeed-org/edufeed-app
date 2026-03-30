/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

// --- Mocks ---

const MEMBER_PUBKEY = 'aaaa'.repeat(16);
const NON_MEMBER_PUBKEY = 'bbbb'.repeat(16);
const LIST_AUTHOR = 'cccc'.repeat(16);

/** Profile list event (kind 30000) with one member */
const profileListEvent = {
  kind: 30000,
  pubkey: LIST_AUTHOR,
  tags: [
    ['d', 'test-list'],
    ['p', MEMBER_PUBKEY]
  ]
};

/** Community event with one section gated by a profile list */
function makeCommunityEvent() {
  return {
    kind: 10222,
    pubkey: 'dddd'.repeat(16),
    tags: [
      ['content', 'calendar'],
      ['k', '31922'],
      ['a', `30000:${LIST_AUTHOR}:test-list`, 'wss://relay.test']
    ]
  };
}

/** BehaviorSubject that emits synchronously on subscribe (mirrors real eventStore) */
let replaceableSubject;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: vi.fn(() => replaceableSubject)
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: vi.fn(() => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }))
}));

const mockManager = { active: { pubkey: MEMBER_PUBKEY } };
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));

// --- Tests ---

describe('useProfileListAccess', () => {
  /** @type {typeof import('$lib/stores/profile-list-access.svelte.js').useProfileListAccess} */
  let useProfileListAccess;

  beforeEach(async () => {
    replaceableSubject = new BehaviorSubject(profileListEvent);
    mockManager.active = { pubkey: MEMBER_PUBKEY };
    const mod = await import('$lib/stores/profile-list-access.svelte.js');
    useProfileListAccess = mod.useProfileListAccess;
  });

  it('does not cause effect_update_depth_exceeded with synchronous BehaviorSubject', () => {
    let access;

    // If untrack() is missing, constructing the hook inside an effect root
    // will throw effect_update_depth_exceeded before the test completes.
    const cleanup = $effect.root(() => {
      access = useProfileListAccess(
        () => makeCommunityEvent(),
        () => ['wss://relay.test']
      );
    });

    flushSync();

    expect(access).toBeDefined();
    expect(access.isLoading).toBe(false);

    cleanup();
  });

  it('canPublish returns true for members', () => {
    let access;

    const cleanup = $effect.root(() => {
      access = useProfileListAccess(
        () => makeCommunityEvent(),
        () => ['wss://relay.test']
      );
    });
    flushSync();

    expect(access.canPublish('calendar')).toBe(true);

    cleanup();
  });

  it('canPublish returns false when user is not a member', () => {
    mockManager.active = { pubkey: NON_MEMBER_PUBKEY };
    let access;

    const cleanup = $effect.root(() => {
      access = useProfileListAccess(
        () => makeCommunityEvent(),
        () => ['wss://relay.test']
      );
    });
    flushSync();

    expect(access.canPublish('calendar')).toBe(false);

    cleanup();
  });

  it('getMembers returns expected pubkey list', () => {
    let access;

    const cleanup = $effect.root(() => {
      access = useProfileListAccess(
        () => makeCommunityEvent(),
        () => ['wss://relay.test']
      );
    });
    flushSync();

    expect(access.getMembers('calendar')).toEqual([MEMBER_PUBKEY]);

    cleanup();
  });

  describe('getAllowedAuthors', () => {
    it('returns null for sections without a profile list (open access)', () => {
      const openCommunity = {
        kind: 10222,
        pubkey: 'dddd'.repeat(16),
        tags: [
          ['content', 'chat'],
          ['k', '9']
        ]
      };

      let access;
      const cleanup = $effect.root(() => {
        access = useProfileListAccess(
          () => openCommunity,
          () => ['wss://relay.test']
        );
      });
      flushSync();

      expect(access.getAllowedAuthors('chat')).toBeNull();
      cleanup();
    });

    it('returns member pubkeys for restricted sections', () => {
      let access;
      const cleanup = $effect.root(() => {
        access = useProfileListAccess(
          () => makeCommunityEvent(),
          () => ['wss://relay.test']
        );
      });
      flushSync();

      const allowed = access.getAllowedAuthors('calendar');
      expect(allowed).toEqual([MEMBER_PUBKEY]);
      cleanup();
    });

    it('returns empty array for restricted section with no members', () => {
      replaceableSubject = new BehaviorSubject({
        kind: 30000,
        pubkey: LIST_AUTHOR,
        tags: [['d', 'test-list']]
      });

      let access;
      const cleanup = $effect.root(() => {
        access = useProfileListAccess(
          () => makeCommunityEvent(),
          () => ['wss://relay.test']
        );
      });
      flushSync();

      const allowed = access.getAllowedAuthors('calendar');
      expect(allowed).toEqual([]);
      cleanup();
    });
  });

  it('returns open access for sections without profile lists', () => {
    const openCommunity = {
      kind: 10222,
      pubkey: 'dddd'.repeat(16),
      tags: [
        ['content', 'chat'],
        ['k', '9']
      ]
    };

    let access;

    const cleanup = $effect.root(() => {
      access = useProfileListAccess(
        () => openCommunity,
        () => ['wss://relay.test']
      );
    });
    flushSync();

    // No profile list → open access
    expect(access.canPublish('chat')).toBe(true);
    expect(access.getMembers('chat')).toEqual([]);

    cleanup();
  });
});
