// @ts-nocheck
/** @vitest-environment node */
/**
 * followed-by loader — "Gefolgt von Anna, Jörg +3" on people search cards:
 * which of the viewer's follows have a subject in their kind 3. Contact
 * lists of the follows that tag the subjects are fetched once per subject
 * (chunked authors), the answer is computed from the EventStore.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMPTY, Subject } from 'rxjs';

const F1 = '1'.repeat(64);
const F2 = '2'.repeat(64);
const F3 = '3'.repeat(64);
const S1 = 'a'.repeat(64);
const S2 = 'b'.repeat(64);

/** @type {Map<string, any>} */
let contactLists = new Map();
const store = vi.hoisted(() => ({ getReplaceable: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: store }));
const loaders = vi.hoisted(() => ({ fetchEvents: vi.fn() }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: loaders.fetchEvents }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup.example']
}));

const mod = await import('$lib/loaders/followed-by.js');

const kind3 = (pubkey, follows) => ({
  kind: 3,
  pubkey,
  created_at: 1,
  tags: follows.map((p) => ['p', p]),
  content: ''
});

beforeEach(() => {
  mod._resetFollowedBy();
  contactLists = new Map([
    [F1, kind3(F1, [S1, S2])],
    [F2, kind3(F2, [S2])]
  ]);
  store.getReplaceable.mockImplementation((_kind, pubkey) => contactLists.get(pubkey));
  loaders.fetchEvents.mockReset();
  loaders.fetchEvents.mockReturnValue(EMPTY);
});

describe('followersAmong', () => {
  it('names the follows whose contact list has the subject, in follow order', () => {
    expect(mod.followersAmong(S2, [F2, F1, F3])).toEqual([F2, F1]);
    expect(mod.followersAmong(S1, [F1, F2, F3])).toEqual([F1]);
  });

  it('never counts the subject as following itself', () => {
    contactLists.set(S1, kind3(S1, [S1]));
    expect(mod.followersAmong(S1, [S1, F2])).toEqual([]);
  });
});

describe('requestFollowedBy', () => {
  it('asks the lookup relays for the follows’ contact lists that tag the subjects', () => {
    mod.requestFollowedBy([S1, S2], [F1, F2]);
    expect(loaders.fetchEvents).toHaveBeenCalledWith(['wss://lookup.example'], {
      kinds: [3],
      authors: [F1, F2],
      '#p': [S1, S2]
    });
  });

  it('asks about a subject only once', () => {
    mod.requestFollowedBy([S1], [F1]);
    mod.requestFollowedBy([S1, S2], [F1]);
    expect(loaders.fetchEvents).toHaveBeenCalledTimes(2);
    expect(loaders.fetchEvents.mock.calls[1][1]['#p']).toEqual([S2]);
  });

  it('asks again when the follow list changes (another account, new follows)', () => {
    mod.requestFollowedBy([S1], [F1]);
    mod.requestFollowedBy([S1], [F1, F2]);
    expect(loaders.fetchEvents).toHaveBeenCalledTimes(2);
  });

  it('chunks a long follow list', () => {
    const follows = Array.from({ length: 450 }, (_, i) => i.toString(16).padStart(64, '0'));
    mod.requestFollowedBy([S1], follows);
    expect(loaders.fetchEvents.mock.calls.map(([, f]) => f.authors.length)).toEqual([200, 200, 50]);
  });

  it('does nothing without follows', () => {
    mod.requestFollowedBy([S1], []);
    expect(loaders.fetchEvents).not.toHaveBeenCalled();
  });

  it('announces arriving contact lists', () => {
    const events = new Subject();
    loaders.fetchEvents.mockReturnValue(events);
    const seen = [];
    const sub = mod.followedByUpdates.subscribe(() => seen.push(1));
    mod.requestFollowedBy([S1], [F1]);
    events.next(kind3(F1, [S1]));
    events.complete();
    sub.unsubscribe();
    expect(seen.length).toBeGreaterThan(0);
  });
});
