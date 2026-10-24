// @ts-nocheck
/** @vitest-environment node */
// The RSVP / poll-response notification chain: once the user's calendar
// events (polls) are loaded, the inbox asks for RSVPs (votes) on them exactly
// once. The v6 loader never completed, so this chain never ran; with
// fetchEvents completing, the model subscription must close itself without
// touching its own handle before it exists (TimelineModel emits synchronously).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };
const PUBKEY = 'u'.repeat(64);
const calendarEvent = {
  id: 'cal1',
  kind: 31923,
  pubkey: PUBKEY,
  tags: [['d', 'meet']],
  created_at: 1
};
const poll = { id: 'poll1', kind: 1068, pubkey: PUBKEY, tags: [], created_at: 1 };
// TimelineModel replays the current timeline synchronously on subscribe
const models = {
  calendar: new BehaviorSubject([calendarEvent]),
  polls: new BehaviorSubject([poll])
};

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    model: vi.fn((_Model, filter) => {
      if (filter?.kinds?.includes(31923) && filter.authors) return models.calendar;
      if (filter?.kinds?.includes(1068) && filter.authors) return models.polls;
      return noopObservable;
    }),
    replaceable: vi.fn(() => noopObservable)
  },
  pool: { group: vi.fn(() => ({ subscription: vi.fn(() => noopObservable) })) }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  // One-shots complete as soon as they are subscribed
  fetchEvents: vi.fn(() => of()),
  addressLoader: vi.fn(() => noopObservable),
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => ['wss://relay3'],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => [],
  getGroupsRelays: () => []
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => []),
  getWriteRelays: vi.fn(async () => [])
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ parseAddressPointerFromATag: vi.fn() }));
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
});

describe('inbox RSVP / poll-response chain', () => {
  let service;
  let fetchEvents;
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);

  beforeEach(async () => {
    vi.resetModules();
    uncaught.length = 0;
    process.on('uncaughtException', onUncaught);
    ({ fetchEvents } = await import('$lib/loaders/base.js'));
    fetchEvents.mockClear();
    service = await import('$lib/services/inbox-service.svelte.js');
  });

  afterEach(() => {
    process.off('uncaughtException', onUncaught);
    service.cleanup();
  });

  const rsvpCalls = () => fetchEvents.mock.calls.filter(([, f]) => f?.kinds?.includes(31925));
  const voteCalls = () => fetchEvents.mock.calls.filter(([, f]) => f?.kinds?.includes(1018));

  it('asks for RSVPs on the calendar events once, even when the model emits synchronously and again later', async () => {
    service.initializeInbox(PUBKEY);
    // The model emitted synchronously on subscribe; a store change emits again
    models.calendar.next([calendarEvent]);
    await new Promise((r) => setTimeout(r, 10));

    expect(rsvpCalls()).toHaveLength(1);
    expect(rsvpCalls()[0][1]).toMatchObject({
      kinds: [31925],
      '#a': [`31923:${PUBKEY}:meet`],
      limit: 50
    });
    expect(uncaught).toEqual([]);
  });

  it('asks for poll responses on the polls once', async () => {
    service.initializeInbox(PUBKEY);
    models.polls.next([poll]);
    await new Promise((r) => setTimeout(r, 10));

    expect(voteCalls()).toHaveLength(1);
    expect(voteCalls()[0][1]).toMatchObject({ kinds: [1018], '#e': ['poll1'], limit: 100 });
    expect(uncaught).toEqual([]);
  });
});
