// @ts-nocheck
/**
 * updateEvent must refuse to change an event's kind (edufeed-app#65)
 *
 * NIP-52 splits calendar events by kind: 31922 is date-based (all-day, `start`
 * is YYYY-MM-DD) and 31923 is time-based (`start` is a unix timestamp, plus a
 * required `D` tag). Toggling all-day therefore forces a kind change — there
 * is no legal way to express an all-day event as a 31923.
 *
 * But a replaceable event is addressed by (kind, pubkey, d-tag), so a new kind
 * is a NEW COORDINATE. Before this guard, toggling all-day published a second
 * live event and left the original untouched; the naddr in the URL still
 * resolved to the pre-edit version, so the user saw a save that silently did
 * nothing — the same symptom as #62, which no cache fix can reach because the
 * edit genuinely went somewhere else. Reproduced in a browser at b82bfe9c:
 * two events at one d-tag, on both relays, original byte-identical.
 *
 * Delete-and-recreate is not a safe alternative — NIP-52 calendars (31924)
 * reference events by `a` = <kind>:<pubkey>:<d> and that list belongs to the
 * calendar owner, who need not be the editor, so this client cannot re-point
 * references it cannot sign.
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
const setEvents = vi.fn();

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
  calendarStore: {
    events: [],
    setEvents: (...args) => setEvents(...args)
  }
}));
vi.mock('$lib/helpers/eventUtils.js', () => ({
  getCalendarEventMetadata: vi.fn((e) => e)
}));

import { createCalendarActions } from '$lib/stores/calendar-actions.svelte.js';

/** Form state for an all-day (date-based) event -> kind 31922. */
const ALL_DAY_FORM = {
  title: 'Updated Title',
  summary: '',
  image: '',
  startDate: '2026-07-08',
  startTime: '',
  endDate: '2026-07-09',
  endTime: '',
  startTimezone: 'Europe/Berlin',
  endTimezone: 'Europe/Berlin',
  location: '',
  isAllDay: true,
  eventType: 'date',
  references: []
};

/** Form state for a timed event -> kind 31923. */
const TIMED_FORM = {
  ...ALL_DAY_FORM,
  startTime: '09:00',
  endTime: '10:00',
  isAllDay: false,
  eventType: 'time'
};

/** @param {number} kind */
const existingEvent = (kind) => ({
  kind,
  pubkey: PK,
  id: '1'.repeat(64),
  tags: [
    ['d', 'event-1'],
    ['title', 'Old Title']
  ],
  content: '',
  created_at: 1000,
  sig: ''
});

describe('updateEvent kind lock (#65)', () => {
  beforeEach(() => {
    signEvent.mockClear();
    eventStoreAdd.mockClear();
    publishEvent.mockClear();
    setEvents.mockClear();
    publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: [] });
  });

  it('refuses to turn a timed event (31923) into an all-day event (31922)', async () => {
    const actions = createCalendarActions('');

    await expect(actions.updateEvent(ALL_DAY_FORM, existingEvent(31923))).rejects.toThrow(
      /all-day and timed/i
    );
  });

  it('refuses to turn an all-day event (31922) into a timed event (31923)', async () => {
    const actions = createCalendarActions('');

    await expect(actions.updateEvent(TIMED_FORM, existingEvent(31922))).rejects.toThrow(
      /all-day and timed/i
    );
  });

  it('publishes nothing at all when the kind would change', async () => {
    // The bug was not a bad event, it was a SECOND event. Refusing after the
    // publish would be no fix: the fork happens at publish time.
    const actions = createCalendarActions('');

    await expect(actions.updateEvent(ALL_DAY_FORM, existingEvent(31923))).rejects.toThrow();

    expect(signEvent).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(eventStoreAdd).not.toHaveBeenCalled();
  });

  it('leaves the calendar store untouched when the kind would change', async () => {
    // updateEvent optimistically rewrites calendarStore before publishing, so
    // a guard placed too late would still show the user a phantom edit.
    const actions = createCalendarActions('');

    await expect(actions.updateEvent(TIMED_FORM, existingEvent(31922))).rejects.toThrow();

    expect(setEvents).not.toHaveBeenCalled();
  });

  it('still allows an ordinary edit that keeps the kind', async () => {
    // The negative control: the guard must not block the normal path. Without
    // it this is the only case here that passes, so it is what proves the
    // other four are testing the guard rather than a broken updateEvent.
    const actions = createCalendarActions('');

    await actions.updateEvent(ALL_DAY_FORM, existingEvent(31922));

    expect(publishEvent).toHaveBeenCalledTimes(1);
    const published = publishEvent.mock.calls[0][0];
    expect(published.kind).toBe(31922);
    expect(published.tags.find((t) => t[0] === 'd')[1]).toBe('event-1');
    expect(published.tags.find((t) => t[0] === 'title')[1]).toBe('Updated Title');
  });
});
