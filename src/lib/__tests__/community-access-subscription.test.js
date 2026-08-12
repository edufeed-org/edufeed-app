/** @vitest-environment node */
// src/lib/__tests__/community-access-subscription.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacySub = vi.fn();
vi.mock('$lib/helpers/profile-list-members.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    subscribeToProfileListMembers: (/** @type {any[]} */ ...args) => legacySub(...args)
  };
});
/** @type {(event: any) => void} */
let emitRelayEvent;
const unsubscribe = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  // eventStore is unused by this suite (subscribeToProfileListMembers is
  // itself mocked above) but the legacy path's real module is still loaded
  // via importOriginal() to preserve buildProfileAccess, and its top-level
  // `import { eventStore } from ...` (transitively via $lib/loaders/base.js
  // too) needs a binding to exist on this full-replacement mock.
  eventStore: {},
  pool: {
    relay: vi.fn(() => ({
      request: vi.fn(() => ({
        subscribe: (/** @type {any} */ handlers) => {
          emitRelayEvent = handlers.next;
          return { unsubscribe };
        }
      }))
    }))
  }
}));

const { subscribeToCommunityAccess } = await import('$lib/groups/community-access-subscription.js');

const RELAY = 'wss://groups.example.com';
const OWNER = 'f'.repeat(64);
const MEMBER = 'b'.repeat(64);
const moderatedEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['membership', 'root1', RELAY],
    ['content', 'Learning'],
    ['k', '30142'],
    ['access', 'members'],
    ['content', 'Forum'],
    ['k', '11']
  ]
};
const openEvent = {
  kind: 10222,
  pubkey: OWNER,
  tags: [
    ['content', 'Forum'],
    ['k', '11']
  ]
};

beforeEach(() => {
  legacySub.mockReset().mockReturnValue({ cleanup: vi.fn(), hasRestrictedSections: false });
  unsubscribe.mockReset();
});

describe('subscribeToCommunityAccess', () => {
  it('delegates non-moderated communities to the legacy subscription', () => {
    const onUpdate = vi.fn();
    const result = subscribeToCommunityAccess(openEvent, [RELAY], onUpdate);
    expect(legacySub).toHaveBeenCalledWith(openEvent, [RELAY], expect.any(Function));
    expect(result.hasRestrictedSections).toBe(false);
  });

  it('moderated: reports restricted sections and filters by roster after events arrive', () => {
    const onUpdate = vi.fn();
    const { cleanup, hasRestrictedSections } = subscribeToCommunityAccess(
      moderatedEvent,
      [RELAY],
      onUpdate
    );
    expect(hasRestrictedSections).toBe(true);
    expect(legacySub).not.toHaveBeenCalled();

    emitRelayEvent({
      kind: 39002,
      tags: [
        ['d', 'root1'],
        ['p', MEMBER]
      ]
    });
    const access = /** @type {any} */ (onUpdate.mock.calls.at(-1))[0];
    expect(access.isLoading).toBe(false);
    expect(access.getAllowedAuthors('Forum')).toBeNull();
    const allowed = access.getAllowedAuthors('Learning');
    expect(allowed).toEqual(expect.arrayContaining([OWNER, MEMBER]));

    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('moderated with no gated sections: no subscription, hasRestrictedSections false', () => {
    const ungated = {
      ...moderatedEvent,
      tags: [
        ['membership', 'root1', RELAY],
        ['content', 'Forum'],
        ['k', '11']
      ]
    };
    const result = subscribeToCommunityAccess(ungated, [RELAY], vi.fn());
    expect(result.hasRestrictedSections).toBe(false);
  });
});
