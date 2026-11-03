// @ts-nocheck
/**
 * A no-op edit of a timed (31923) calendar event must not mutate the stored
 * start/end instant or its timezone tags (edufeed-app issue
 * 06e6709dec781493ca9f04c497e3685a170503a88cb87f071c15cb95955e8fe3):
 *
 * - The edit form is HH:MM — reading it back with wallClockToTimestamp always
 *   lands on :00 seconds, so an untouched field used to silently drop any
 *   stored seconds on save.
 * - end_tzid was written whenever formData.endTimezone was truthy, even when
 *   the event has no end at all (formData.endTimezone defaults to something
 *   even without an end date/time).
 * - A zone-less event always shows a zone in the edit form (falls back to
 *   the editor's own zone for display), and that shown zone used to be
 *   written back as start_tzid/end_tzid even when nothing was touched.
 *
 * Only a field the user actually changes is read in the shown zone and may
 * then gain a zone tag — see convertFormDataToEvent in helpers/calendar.js.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PK = 'a'.repeat(64);

const signEvent = vi.fn(async (template) => ({
  ...template,
  id: 'e'.repeat(64),
  pubkey: PK,
  sig: 'f'.repeat(128)
}));
const publishEvent = vi.fn(async () => ({ success: true, successCount: 1, relays: [] }));

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
  eventStore: { add: vi.fn() },
  pool: {}
}));
vi.mock('$lib/stores/calendar-events.svelte.js', () => ({
  calendarStore: { events: [], setEvents: vi.fn() }
}));
vi.mock('$lib/helpers/eventUtils.js', () => ({
  getCalendarEventMetadata: vi.fn((e) => e)
}));

import { createCalendarActions } from '$lib/stores/calendar-actions.svelte.js';
import { zonedWallClock } from '$lib/helpers/calendar.js';

const ORIGINAL_TZ = process.env.TZ;
beforeEach(() => {
  signEvent.mockClear();
  publishEvent.mockClear();
  process.env.TZ = 'Europe/Berlin';
});
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** @param {string[][]} tags @param {string} name */
const tagValue = (tags, name) => tags.find((t) => t[0] === name)?.[1];

// What the edit form would show for a stored instant — same helper the real
// edit form uses (CalendarEventModal's initializeFormForEdit), so these
// fixtures are exactly what a user opening the form would see untouched.
const wallClock = zonedWallClock;

describe('updateEvent: no-op edit preserves timed metadata', () => {
  it('keeps the stored seconds of start/end on a no-op edit', async () => {
    // 10:17:35 New York — the HH:MM form can only show 10:17.
    const start = Math.floor(Date.parse('2026-11-10T15:17:35Z') / 1000);
    const end = start + 1800; // +30:00, still :35 seconds
    const existing = {
      kind: 31923,
      pubkey: PK,
      id: '1'.repeat(64),
      tags: [
        ['d', 'event-1'],
        ['start', start.toString()],
        ['end', end.toString()],
        ['start_tzid', 'America/New_York'],
        ['end_tzid', 'America/New_York']
      ],
      content: '',
      created_at: 1000,
      sig: ''
    };
    const startWall = wallClock(start, 'America/New_York');
    const endWall = wallClock(end, 'America/New_York');
    const formData = {
      title: 'Webinar',
      summary: '',
      image: '',
      startDate: startWall.date,
      startTime: startWall.time,
      endDate: endWall.date,
      endTime: endWall.time,
      startTimezone: 'America/New_York',
      endTimezone: 'America/New_York',
      location: '',
      isAllDay: false,
      eventType: 'time',
      references: []
    };

    const actions = createCalendarActions('');
    await actions.updateEvent(formData, existing);

    const published = publishEvent.mock.calls[0][0];
    expect(tagValue(published.tags, 'start')).toBe(start.toString());
    expect(tagValue(published.tags, 'end')).toBe(end.toString());
  });

  it('leaves a zone-less event zone-less on a no-op edit', async () => {
    // No start_tzid/end_tzid on the stored event; the form falls back to the
    // editor's own zone (Berlin) just to display something.
    const startSeconds = Math.floor(Date.parse('2026-11-10T09:00:00Z') / 1000);
    const endSeconds = startSeconds + 3600;
    const existing = {
      kind: 31923,
      pubkey: PK,
      id: '2'.repeat(64),
      tags: [
        ['d', 'event-2'],
        ['start', startSeconds.toString()],
        ['end', endSeconds.toString()]
      ],
      content: '',
      created_at: 1000,
      sig: ''
    };
    const startWall = wallClock(startSeconds, 'Europe/Berlin');
    const endWall = wallClock(endSeconds, 'Europe/Berlin');
    const formData = {
      title: 'Webinar',
      summary: '',
      image: '',
      startDate: startWall.date,
      startTime: startWall.time,
      endDate: endWall.date,
      endTime: endWall.time,
      // The modal defaults a zone-less event's shown zone to the editor's own.
      startTimezone: 'Europe/Berlin',
      endTimezone: 'Europe/Berlin',
      location: '',
      isAllDay: false,
      eventType: 'time',
      references: []
    };

    const actions = createCalendarActions('');
    await actions.updateEvent(formData, existing);

    const published = publishEvent.mock.calls[0][0];
    expect(tagValue(published.tags, 'start')).toBe(startSeconds.toString());
    expect(tagValue(published.tags, 'end')).toBe(endSeconds.toString());
    expect(tagValue(published.tags, 'start_tzid')).toBeUndefined();
    expect(tagValue(published.tags, 'end_tzid')).toBeUndefined();
  });

  it('adopts the shown (editor) zone once a zone-less event is actually edited', async () => {
    const startSeconds = Math.floor(Date.parse('2026-11-10T09:00:00Z') / 1000);
    const existing = {
      kind: 31923,
      pubkey: PK,
      id: '3'.repeat(64),
      tags: [
        ['d', 'event-3'],
        ['start', startSeconds.toString()]
      ],
      content: '',
      created_at: 1000,
      sig: ''
    };
    const startWall = wallClock(startSeconds, 'Europe/Berlin');
    const formData = {
      title: 'Webinar',
      summary: '',
      image: '',
      startDate: startWall.date,
      // User moves the start time one hour later.
      startTime: '11:00',
      endDate: '',
      endTime: '',
      startTimezone: 'Europe/Berlin',
      endTimezone: 'Europe/Berlin',
      location: '',
      isAllDay: false,
      eventType: 'time',
      references: []
    };

    const actions = createCalendarActions('');
    await actions.updateEvent(formData, existing);

    const published = publishEvent.mock.calls[0][0];
    expect(tagValue(published.tags, 'start')).toBe(
      Math.floor(Date.parse('2026-11-10T10:00:00Z') / 1000).toString()
    );
    expect(tagValue(published.tags, 'start_tzid')).toBe('Europe/Berlin');
  });

  it('never writes end_tzid when the event has no end, even with a stale formData.endTimezone', async () => {
    const startSeconds = Math.floor(Date.parse('2026-11-10T09:00:00Z') / 1000);
    const existing = {
      kind: 31923,
      pubkey: PK,
      id: '4'.repeat(64),
      tags: [
        ['d', 'event-4'],
        ['start', startSeconds.toString()],
        ['start_tzid', 'America/New_York']
      ],
      content: '',
      created_at: 1000,
      sig: ''
    };
    const startWall = wallClock(startSeconds, 'America/New_York');
    const formData = {
      title: 'Webinar',
      summary: '',
      image: '',
      startDate: startWall.date,
      startTime: startWall.time,
      endDate: '',
      endTime: '',
      startTimezone: 'America/New_York',
      // A truthy endTimezone with no end date/time must not produce end_tzid.
      endTimezone: 'America/New_York',
      location: '',
      isAllDay: false,
      eventType: 'time',
      references: []
    };

    const actions = createCalendarActions('');
    await actions.updateEvent(formData, existing);

    const published = publishEvent.mock.calls[0][0];
    expect(tagValue(published.tags, 'end')).toBeUndefined();
    expect(tagValue(published.tags, 'end_tzid')).toBeUndefined();
  });
});
