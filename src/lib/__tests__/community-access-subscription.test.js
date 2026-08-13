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
/** Full handlers object for the last-opened subscription — lets tests drive
 * `complete`/`error` too, not just `next`. */
/** @type {any} */
let relayHandlers;
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
          relayHandlers = handlers;
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

  // Dead-relay spinner fix (same underlying bug as channel-rosters.svelte.js):
  // buildRosterAccess().isLoading reads roster.isLoading, which stays true
  // forever if the relay request never delivers a 39001/39002 AND never
  // resolves the pending id — the dashboard's publish gate would then never
  // leave its conservative "only the owner may publish" state.
  it('moderated: a relay that completes with no roster still resolves isLoading to false (non-member)', () => {
    const onUpdate = vi.fn();
    subscribeToCommunityAccess(moderatedEvent, [RELAY], onUpdate);

    relayHandlers.complete();

    const access = /** @type {any} */ (onUpdate.mock.calls.at(-1))[0];
    expect(access.isLoading).toBe(false);
    expect(access.getAllowedAuthors('Learning')).toEqual([OWNER]);
  });

  // applesauce's pool.relay().request() errors (rather than completes) when
  // the relay never sends anything at all within its timeout window — see
  // channel-rosters.svelte.js's resolveEmpty comment for the rxjs citation.
  // Parity with the legacy path: the caller must never see an error, but the
  // roster must still resolve instead of spinning.
  it('moderated: a relay that errors instead of completing also resolves isLoading to false', () => {
    const onUpdate = vi.fn();
    subscribeToCommunityAccess(moderatedEvent, [RELAY], onUpdate);

    expect(() => relayHandlers.error(new Error('relay timeout'))).not.toThrow();

    const access = /** @type {any} */ (onUpdate.mock.calls.at(-1))[0];
    expect(access.isLoading).toBe(false);
    expect(access.getAllowedAuthors('Learning')).toEqual([OWNER]);
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
