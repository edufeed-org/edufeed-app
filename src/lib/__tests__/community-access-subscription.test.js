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
// The fetch is now an eventStore-backed pipe: the request FEEDS the store
// (storeEvents) and the roster is READ from eventStore.model. A test drives the
// relay via a fresh Subject per subscription; a real EventStore holds the
// events. `latest` exposes the current subscription's driver + eventStore for
// the tests.
const RELAY_PK = '9'.repeat(64);
/** @type {any} */
let latest;
const { Subject } = await import('rxjs');
const { EventStore } = await import('applesauce-core');
const realEventStore = new EventStore();
realEventStore.verifyEvent = () => true;
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: realEventStore,
  pool: {
    relay: vi.fn(() => ({
      request: vi.fn(() => {
        const subject = new Subject();
        latest = { subject };
        return subject;
      })
    }))
  }
}));

const { subscribeToCommunityAccess } = await import('$lib/groups/community-access-subscription.js');

const RELAY = 'wss://groups.example.com';
const OWNER = 'f'.repeat(64);
const MEMBER = 'b'.repeat(64);
let evtSeq = 0;
/** @param {any} partial */
const relayEvent = (partial) => ({
  pubkey: RELAY_PK,
  created_at: 1000 + evtSeq,
  id: `ev-${evtSeq++}`,
  sig: 'x',
  content: '',
  ...partial
});
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
  realEventStore.removeByFilters?.({ kinds: [39001, 39002] });
  latest = null;
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

    latest.subject.next(
      relayEvent({
        kind: 39002,
        tags: [
          ['d', 'root1'],
          ['p', MEMBER]
        ]
      })
    );
    const access = /** @type {any} */ (onUpdate.mock.calls.at(-1))[0];
    expect(access.isLoading).toBe(false);
    expect(access.getAllowedAuthors('Forum')).toBeNull();
    const allowed = access.getAllowedAuthors('Learning');
    expect(allowed).toEqual(expect.arrayContaining([OWNER, MEMBER]));

    // cleanup must not throw (unsubscribes the store read + the fetch).
    expect(() => cleanup()).not.toThrow();
  });

  // Dead-relay spinner fix (same underlying bug as channel-rosters.svelte.js):
  // buildRosterAccess().isLoading reads roster.isLoading, which stays true
  // forever if the relay request never delivers a 39001/39002 AND never
  // resolves the pending id — the dashboard's publish gate would then never
  // leave its conservative "only the owner may publish" state.
  it('moderated: a relay that completes with no roster still resolves isLoading to false (non-member)', () => {
    const onUpdate = vi.fn();
    subscribeToCommunityAccess(moderatedEvent, [RELAY], onUpdate);

    latest.subject.complete();

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

    expect(() => latest.subject.error(new Error('relay timeout'))).not.toThrow();

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
