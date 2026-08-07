// @ts-nocheck
/**
 * createCalendar must reach the EventStore (edufeed-app#64)
 *
 * Kind 31924 is a cacheable kind and `publishEvent` never touches the
 * EventStore, so without an explicit add the new calendar is missing from IDB
 * until a relay round-trip fills it in. Milder than the update case in #62 —
 * there is no stale prior version to be served — but the same shape.
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

describe('createCalendar EventStore write (#64)', () => {
  beforeEach(() => {
    signEvent.mockClear();
    publishEvent.mockClear();
    publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: [] });
    eventStoreAdd.mockClear();
  });

  it('adds the published calendar to the EventStore', async () => {
    const actions = createCalendarActions('');
    const calendar = await actions.createCalendar('My Calendar', 'notes');

    expect(eventStoreAdd).toHaveBeenCalledTimes(1);
    expect(eventStoreAdd).toHaveBeenCalledWith(calendar);
    expect(calendar.kind).toBe(31924);
  });

  it('does NOT cache the calendar when no relay accepted the publish', async () => {
    publishEvent.mockResolvedValue({ success: false, successCount: 0, relays: [] });

    const actions = createCalendarActions('');
    await actions.createCalendar('My Calendar');

    expect(eventStoreAdd).not.toHaveBeenCalled();
  });

  it('no longer exposes the dead deleteEvent action', () => {
    // It published a kind 5 with neither an eventStore.add nor a
    // cacheDeletion — the exact failure the cacheDeletion doc warns about —
    // and had no callers. The calendar UI deletes through
    // helpers/eventDeletion.js, which does both. Removed so it is not copied.
    expect(createCalendarActions('')).not.toHaveProperty('deleteEvent');
  });
});
