// @ts-nocheck
/**
 * updateEvent must write the updated event into the EventStore (edufeed-app#62)
 *
 * The event detail page reads through applesauce's addressLoader, whose first
 * step is the IndexedDB cache. A cache hit ends the loading sequence before any
 * relay is queried, so the page renders whatever the cache holds. The cache is
 * fed from `eventStore.insert$`, and `publishEvent` — unlike
 * `publishEventOptimistic`, which createEvent uses — never touches the
 * EventStore. Without an explicit add, an edited event stays stale on reload
 * forever even though the relay holds only the new version.
 *
 * Updating `calendarStore` is NOT a substitute: that is the list view's state,
 * not the detail page's read path.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PK = 'a'.repeat(64);

const signEvent = vi.fn(async (template) => ({
  ...template,
  id: 'e'.repeat(64),
  pubkey: PK,
  sig: 'f'.repeat(128)
}));

const publishEvent = vi.fn(async () => ({ success: true, successCount: 1, relays: [] }));
const eventStoreAdd = vi.fn();

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'a'.repeat(64), signEvent: (t) => signEvent(t) } }
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({ build: async (t) => t })
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (...args) => publishEvent(...args),
  publishEventOptimistic: vi.fn(),
  buildATagWithHint: vi.fn(),
  buildETagWithHint: vi.fn(),
  buildPTagsWithHints: vi.fn()
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (...args) => eventStoreAdd(...args) },
  pool: {}
}));
vi.mock('$lib/stores/calendar-events.svelte.js', () => ({
  calendarStore: { events: [], setEvents: vi.fn() }
}));
vi.mock('$lib/helpers/eventUtils.js', () => ({
  getCalendarEventMetadata: vi.fn((e) => e)
}));

import { createCalendarActions } from '$lib/stores/calendar-actions.svelte.js';

const FORM_DATA = {
  title: 'Updated Title',
  summary: '',
  image: '',
  startDate: '2026-07-08',
  startTime: '09:00',
  endDate: '2026-07-09',
  endTime: '10:00',
  startTimezone: 'Europe/Berlin',
  endTimezone: 'Europe/Berlin',
  location: '',
  isAllDay: true,
  eventType: 'date',
  references: []
};

const EXISTING = {
  kind: 31922,
  pubkey: PK,
  id: '1'.repeat(64),
  tags: [
    ['d', 'event-1'],
    ['title', 'Old Title']
  ],
  content: '',
  created_at: 0,
  sig: ''
};

describe('updateEvent EventStore write (#62)', () => {
  beforeEach(() => {
    signEvent.mockClear();
    eventStoreAdd.mockClear();
    publishEvent.mockClear();
    publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: [] });
  });

  it('adds the updated event to the EventStore so the cache is not left stale', async () => {
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, EXISTING);

    expect(eventStoreAdd).toHaveBeenCalledTimes(1);
    const added = eventStoreAdd.mock.calls[0][0];
    // Same replaceable coordinate as the original...
    expect(added.kind).toBe(31922);
    expect(added.pubkey).toBe(PK);
    expect(added.tags.find((t) => t[0] === 'd')[1]).toBe('event-1');
    // ...carrying the NEW title, which is the whole point.
    expect(added.tags.find((t) => t[0] === 'title')[1]).toBe('Updated Title');
  });

  it('adds the signed event itself, not the dTag-decorated return value', async () => {
    // eventStore.add validates the event, so it must receive a plain Nostr
    // event. The `dTag` property on the returned object is app-local.
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, EXISTING);

    expect(eventStoreAdd.mock.calls[0][0]).not.toHaveProperty('dTag');
    expect(eventStoreAdd.mock.calls[0][0].sig).toBe('f'.repeat(128));
  });

  it('does NOT cache the event when no relay accepted the publish', async () => {
    // Mirrors publishEventOptimistic, which removes the optimistically added
    // event when successCount is 0. A cached event that never landed on a relay
    // would be served to the user as though it had.
    publishEvent.mockResolvedValue({ success: false, successCount: 0, relays: [] });

    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, EXISTING);

    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(eventStoreAdd).not.toHaveBeenCalled();
  });

  it('does not turn a cache-write failure into a failed update', async () => {
    // The real eventStore.add validates the event and throws on a malformed
    // one. The publish has already landed by then, so surfacing that as
    // "Failed to update calendar event" would report a successful save as a
    // failure. Degrade to the stale read instead — the cache is additive.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    eventStoreAdd.mockImplementation(() => {
      throw new Error("can't serialize event with wrong or missing properties");
    });

    const actions = createCalendarActions('');
    await expect(actions.updateEvent(FORM_DATA, EXISTING)).resolves.toBeTruthy();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('stamps created_at strictly newer than the event it replaces', async () => {
    // A replacement sharing a wall-clock second with its predecessor is
    // dropped by three layers with two different tie-breaks: relays and
    // applesauce's EventStore keep the LOWER id (a coin flip), and nostr-idb
    // requires strictly-greater so the IDB write is ALWAYS rejected. The
    // cache being first in the loader sequence then makes the stale read
    // permanent. Reachable by editing straight after creating.
    const now = Math.floor(Date.now() / 1000);
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, { ...EXISTING, created_at: now });

    expect(eventStoreAdd.mock.calls[0][0].created_at).toBe(now + 1);
  });

  it('uses wall-clock time when the existing event is genuinely older', async () => {
    // Control for the above: the bump must not run away from real time on
    // every edit, only close a tie.
    const now = Math.floor(Date.now() / 1000);
    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, { ...EXISTING, created_at: now - 3600 });

    const stamped = eventStoreAdd.mock.calls[0][0].created_at;
    expect(stamped).toBeGreaterThanOrEqual(now);
    expect(stamped).toBeLessThanOrEqual(now + 1);
  });

  it('caches only after the publish resolves, never before', async () => {
    // Ordering control: if the add ran first, a failed publish could not be
    // distinguished from a successful one by the assertion above.
    const order = [];
    publishEvent.mockImplementation(async () => {
      order.push('publish');
      return { success: true, successCount: 1, relays: [] };
    });
    eventStoreAdd.mockImplementation(() => order.push('add'));

    const actions = createCalendarActions('');
    await actions.updateEvent(FORM_DATA, EXISTING);

    expect(order).toEqual(['publish', 'add']);
  });
});
