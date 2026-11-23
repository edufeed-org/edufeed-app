/** @vitest-environment node */
// updatePersonalGroupsList must NOT add the signed event to the eventStore
// itself: publishEventOptimistic captures the version it replaces BEFORE its
// own add (#64 rollback). A pre-add makes that capture see the replacement,
// so a total publish failure would evict the predecessor and roll back to
// nothing — the user's whole groups list gone locally.
//
// And it must never build on "no list" just because the list has not arrived
// yet: a join clicked before the relays answered replaced the whole list with
// one entry. Every edit asks the relays first.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMPTY, of, throwError } from 'rxjs';

const ME = 'a'.repeat(64);
const OWN = 'wss://own.example/';
const LOOKUP = 'wss://lookup.example/';

/** @type {{ stored: any }} */
const state = vi.hoisted(() => ({ stored: null }));
const eventStore = vi.hoisted(() => ({
  add: vi.fn((/** @type {any} */ event) => {
    if (!state.stored || event.created_at > state.stored.created_at) state.stored = event;
  }),
  getReplaceable: vi.fn(() => state.stored)
}));
/** @type {{ answers: Record<string, import('rxjs').Observable<any>> }} */
const relays = vi.hoisted(() => ({ answers: {} }));
const pool = vi.hoisted(() => ({
  relay: vi.fn((/** @type {string} */ url) => ({ request: vi.fn(() => relays.answers[url]) }))
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore, pool }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: vi.fn(async () => [OWN])
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [LOOKUP] }));

const publishEventOptimistic = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic }));

const { updatePersonalGroupsList } = await import('$lib/groups/personal-groups-list.js');

const listEvent = (/** @type {string[][]} */ tags, created_at = 100) => ({
  kind: 10009,
  pubkey: ME,
  content: '',
  created_at,
  tags
});
const dead = () => throwError(() => new Error('connection refused'));
const groupTags = () =>
  publishEventOptimistic.mock.calls[0][0].tags.filter(
    (/** @type {string[]} */ t) => t[0] === 'group'
  );

describe('updatePersonalGroupsList', () => {
  const user = {
    pubkey: ME,
    signer: {
      signEvent: vi.fn(async (/** @type {any} */ t) => ({ ...t, id: 'ev1', sig: 'x' }))
    }
  };

  beforeEach(() => {
    state.stored = null;
    relays.answers = { [OWN]: EMPTY, [LOOKUP]: EMPTY };
    eventStore.add.mockClear();
    publishEventOptimistic.mockClear();
  });

  it('hands the signed 10009 to publishEventOptimistic without pre-adding it', async () => {
    await updatePersonalGroupsList(user, { add: { id: 'g1', relay: 'wss://groups.example' } });

    expect(publishEventOptimistic).toHaveBeenCalledOnce();
    const [signed] = publishEventOptimistic.mock.calls[0];
    expect(signed.kind).toBe(10009);
    expect(signed.tags).toEqual(expect.arrayContaining([['group', 'g1', 'wss://groups.example/']]));
    // The publish path owns the one and only eventStore.add — a caller-side
    // pre-add defeats its replaced-version rollback.
    expect(eventStore.add).not.toHaveBeenCalled();
  });

  it('does nothing without a signer', async () => {
    await updatePersonalGroupsList(null, { add: { id: 'g1', relay: 'wss://x' } });
    expect(publishEventOptimistic).not.toHaveBeenCalled();
  });

  describe('asks the relays for the current list before every edit', () => {
    it('builds on the list a relay holds when the store has none yet', async () => {
      relays.answers[OWN] = of(listEvent([['group', 'old', 'wss://groups.example/']]));
      await updatePersonalGroupsList(user, { add: { id: 'g1', relay: 'wss://groups.example' } });

      expect(groupTags()).toEqual([
        ['group', 'old', 'wss://groups.example/'],
        ['group', 'g1', 'wss://groups.example/']
      ]);
    });

    it('builds on a newer relay copy instead of the stale one in the store', async () => {
      state.stored = listEvent([['group', 'old', 'wss://groups.example/']], 100);
      relays.answers[LOOKUP] = of(
        listEvent(
          [
            ['group', 'old', 'wss://groups.example/'],
            ['group', 'elsewhere', 'wss://groups.example/']
          ],
          200
        )
      );
      await updatePersonalGroupsList(user, { add: { id: 'g1', relay: 'wss://groups.example' } });

      expect(groupTags().map((/** @type {string[]} */ t) => t[1])).toEqual([
        'old',
        'elsewhere',
        'g1'
      ]);
    });

    it('refuses to write when there is no copy and no relay of mine answered', async () => {
      // The lookup relay saying "nothing" proves nothing: the list lives on
      // the user's own write relays.
      relays.answers[OWN] = dead();
      await expect(
        updatePersonalGroupsList(user, { add: { id: 'g1', relay: 'wss://groups.example' } })
      ).rejects.toThrow(/groups list/);
      expect(publishEventOptimistic).not.toHaveBeenCalled();
    });

    it('still edits the copy it has when every relay is down', async () => {
      state.stored = listEvent([['group', 'old', 'wss://groups.example/']]);
      relays.answers = { [OWN]: dead(), [LOOKUP]: dead() };
      await updatePersonalGroupsList(user, {
        remove: { id: 'old', relay: 'wss://groups.example' }
      });

      expect(groupTags()).toEqual([]);
    });
  });
});
