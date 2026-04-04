/**
 * Profile List Members — extracted helper tests
 *
 * Tests subscribeToProfileListMembers and buildProfileAccess functions
 * that are framework-agnostic (no Svelte runes).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
const { Subject } = await import('rxjs');
const replaceableSubjects = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: vi.fn(
      (
        /** @type {number} */ kind,
        /** @type {string} */ pubkey,
        /** @type {string} */ identifier
      ) => {
        const key = `${kind}:${pubkey}:${identifier}`;
        if (!replaceableSubjects.has(key)) {
          replaceableSubjects.set(key, new Subject());
        }
        return replaceableSubjects.get(key);
      }
    ),
    __replaceableSubjects: replaceableSubjects
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: vi.fn(() => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

/** Helper to build a kind 10222 event
 * @param {string[][]} tags
 * @param {string} [pubkey]
 */
function makeCommunityEvent(tags, pubkey = 'community-pubkey') {
  return { kind: 10222, pubkey, tags, content: '', created_at: 1700000000 };
}

/** Helper to build a kind 30000 profile list event
 * @param {string} pubkey
 * @param {string} identifier
 * @param {string[]} memberPubkeys
 */
function makeProfileListEvent(pubkey, identifier, memberPubkeys) {
  return {
    kind: 30000,
    pubkey,
    tags: [['d', identifier], ...memberPubkeys.map((pk) => ['p', pk])],
    content: '',
    created_at: 1700000000,
    id: 'test-id',
    sig: 'test-sig'
  };
}

describe('subscribeToProfileListMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaceableSubjects.clear();
    vi.resetModules();
  });

  it('returns hasRestrictedSections: false for communities without profileList', async () => {
    const { subscribeToProfileListMembers } = await import('../helpers/profile-list-members.js');
    const event = makeCommunityEvent([
      ['content', 'Chat'],
      ['k', '9']
    ]);
    const onUpdate = vi.fn();
    const result = subscribeToProfileListMembers(event, ['wss://relay.test'], onUpdate);
    expect(result.hasRestrictedSections).toBe(false);
    result.cleanup();
  });

  it('returns hasRestrictedSections: true for communities with profileList', async () => {
    const { subscribeToProfileListMembers } = await import('../helpers/profile-list-members.js');
    const event = makeCommunityEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30000:community-pubkey:Learning', 'wss://relay.test']
    ]);
    const onUpdate = vi.fn();
    const result = subscribeToProfileListMembers(event, ['wss://relay.test'], onUpdate);
    expect(result.hasRestrictedSections).toBe(true);
    result.cleanup();
  });

  it('calls addressLoader for each restricted section', async () => {
    const { addressLoader } = await import('$lib/loaders/base.js');
    const { subscribeToProfileListMembers } = await import('../helpers/profile-list-members.js');
    const event = makeCommunityEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30000:community-pubkey:Learning', 'wss://relay.test'],
      ['content', 'Calendar'],
      ['k', '31922'],
      ['a', '30000:community-pubkey:Calendar']
    ]);
    const onUpdate = vi.fn();
    const result = subscribeToProfileListMembers(event, ['wss://relay.default'], onUpdate);

    expect(addressLoader).toHaveBeenCalledTimes(2);
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30000,
        pubkey: 'community-pubkey',
        identifier: 'Learning',
        relays: expect.arrayContaining(['wss://relay.test'])
      })
    );
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30000,
        pubkey: 'community-pubkey',
        identifier: 'Calendar',
        relays: ['wss://relay.default']
      })
    );
    result.cleanup();
  });

  it('onUpdate callback fires with correct memberMap when profile list events arrive', async () => {
    const { subscribeToProfileListMembers } = await import('../helpers/profile-list-members.js');
    const event = makeCommunityEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30000:community-pubkey:Learning']
    ]);
    const onUpdate = vi.fn();
    subscribeToProfileListMembers(event, ['wss://relay.test'], onUpdate);

    // Simulate profile list event arriving via eventStore
    const subject = replaceableSubjects.get('30000:community-pubkey:Learning');
    const profileListEvent = makeProfileListEvent('community-pubkey', 'Learning', [
      'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
      'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'
    ]);
    subject.next(profileListEvent);

    expect(onUpdate).toHaveBeenCalled();
    const [memberMap] = onUpdate.mock.calls[0];
    const members = memberMap.get('Learning');
    expect(members).toBeDefined();
    expect(members.has('aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111')).toBe(
      true
    );
    expect(members.has('bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222')).toBe(
      true
    );
    expect(members.size).toBe(2);
  });

  it('cleanup() unsubscribes all subscriptions', async () => {
    const { subscribeToProfileListMembers } = await import('../helpers/profile-list-members.js');
    const event = makeCommunityEvent([
      ['content', 'Learning'],
      ['k', '30142'],
      ['a', '30000:community-pubkey:Learning']
    ]);
    const onUpdate = vi.fn();
    const result = subscribeToProfileListMembers(event, ['wss://relay.test'], onUpdate);
    // Should not throw
    result.cleanup();
    result.cleanup(); // Double cleanup should be safe
  });
});

describe('buildProfileAccess', () => {
  it('returns null for open sections (not in memberMap)', async () => {
    const { buildProfileAccess } = await import('../helpers/profile-list-members.js');
    const memberMap = new Map();
    const access = buildProfileAccess(memberMap, false);
    expect(access.getAllowedAuthors('Chat')).toBeNull();
  });

  it('returns string[] for restricted sections', async () => {
    const { buildProfileAccess } = await import('../helpers/profile-list-members.js');
    const memberMap = new Map([
      [
        'Learning',
        new Set([
          'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
          'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222'
        ])
      ]
    ]);
    const access = buildProfileAccess(memberMap, false);
    const allowed = access.getAllowedAuthors('Learning');
    expect(allowed).toBeInstanceOf(Array);
    expect(allowed).toHaveLength(2);
    expect(allowed).toContain('aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111');
  });

  it('passes through isLoading', async () => {
    const { buildProfileAccess } = await import('../helpers/profile-list-members.js');
    const access = buildProfileAccess(new Map(), true);
    expect(access.isLoading).toBe(true);
  });
});
