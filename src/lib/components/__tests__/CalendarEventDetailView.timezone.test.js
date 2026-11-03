// @ts-nocheck
/**
 * NIP-52 start_tzid/end_tzid: the detail view printed the viewer's local time
 * next to the event's zone label — a 10:00 New York event read "16:00
 * (America/New_York)" in Berlin. It shows the event-zone time with its label
 * now, plus the viewer's own time when that differs; an end without end_tzid
 * is in start_tzid's zone.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { NEVER } from 'rxjs';

const h = vi.hoisted(() => ({ group: null, rsvps: null }));
h.group = vi.fn(() => ({ request: () => NEVER }));
h.rsvps = vi.fn(() => ({ rsvps: [], loading: false }));
const ME = 'a'.repeat(64);

vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  // featured calendars: fetchEvents (pool.request) + eventStore.model
  eventStore: { add: vi.fn(), model: () => NEVER },
  pool: { group: (...a) => h.group(...a), request: () => NEVER }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME }),
  manager: { active: { pubkey: ME } }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appRelays: {}, calendar: { locale: 'de-DE', timeFormat: '24h' } }
}));
vi.mock('$lib/stores/calendar-event-rsvps.svelte.js', () => ({
  useCalendarEventRsvps: (...a) => h.rsvps(...a)
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock(
  '$lib/components/shared/DetailHeader.svelte',
  () => import('./fixtures/DetailHeaderStub.svelte')
);
vi.mock(
  '$lib/components/comments/CommentList.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/reactions/ReactionBar.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/MarkdownRenderer.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/AddToCalendarDropdown.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/calendar/EventTags.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock('$lib/components/shared/LocationLink.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/EventLocationMap.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/ProfileCard.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/NamedParticipant.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/calendar/InlineRsvp.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/AttendeeIndicator.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/HeroImage.svelte', () => import('./__mocks__/EmptyStub.svelte'));

const { default: CalendarEventDetailView } = await import(
  '$lib/components/calendar/CalendarEventDetailView.svelte'
);

// The worker's zone cannot be switched at runtime; pin the viewer's zone the
// way getCurrentTimezone() reads it.
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function () {
    return { ...realResolved.call(this), timeZone: 'Europe/Berlin' };
  });
});
afterEach(() => vi.restoreAllMocks());

// 2026-05-04 10:00 New York = 16:00 Berlin; ends 11:30 New York = 17:30 Berlin
const START = Date.UTC(2026, 4, 4, 14, 0) / 1000;
const END = Date.UTC(2026, 4, 4, 15, 30) / 1000;

function fixture(extra = {}) {
  const rawEvent = {
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', 'tz'],
      ['title', 'Webinar'],
      ['start', String(START)],
      ['end', String(END)]
    ]
  };
  const event = {
    id: rawEvent.id,
    kind: 31923,
    pubkey: ME,
    title: 'Webinar',
    start: START,
    end: END,
    dTag: 'tz',
    participants: [],
    hashtags: [],
    references: [],
    originalEvent: rawEvent,
    ...extra
  };
  return { event, rawEvent };
}

describe('CalendarEventDetailView — event time zone', () => {
  it("shows the event-zone time with its label and the viewer's time beside it", () => {
    render(CalendarEventDetailView, {
      props: fixture({ startTimezone: 'America/New_York', endTimezone: 'America/New_York' })
    });
    const start = screen.getByTestId('event-start-time').textContent;
    expect(start).toContain('10:00');
    expect(start).toContain('America/New_York');
    expect(start).toContain('(16:00 Europe/Berlin)');
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('America/New_York');
    expect(end).toContain('(17:30 Europe/Berlin)');
  });

  it("labels the end with start_tzid's zone when end_tzid is missing", () => {
    render(CalendarEventDetailView, { props: fixture({ startTimezone: 'America/New_York' }) });
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('America/New_York');
  });

  it('shows only one time when the event is in the viewer zone', () => {
    render(CalendarEventDetailView, {
      props: fixture({ startTimezone: 'Europe/Berlin', endTimezone: 'Europe/Berlin' })
    });
    const start = screen.getByTestId('event-start-time').textContent;
    expect(start).toContain('16:00');
    expect(start).toContain('Europe/Berlin');
    expect(start).not.toContain('(');
  });
});

// M1: 31922 (date-based) timestamps are UTC midnight. Formatting them
// without `{ utc: true }` renders the day before for a viewer west of UTC.
describe('CalendarEventDetailView — all-day dates west of UTC (M1)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // 2026-11-03 as a NIP-52 date-based event: UTC midnight.
  const ALL_DAY_START = Date.UTC(2026, 10, 3) / 1000;
  const ALL_DAY_END = Date.UTC(2026, 10, 5) / 1000;

  function allDayFixture(extra = {}) {
    const rawEvent = {
      id: 'f'.repeat(64),
      kind: 31922,
      pubkey: ME,
      created_at: 1_700_000_000,
      content: '',
      tags: [
        ['d', 'ad'],
        ['title', 'Conference']
      ]
    };
    return {
      event: {
        id: rawEvent.id,
        kind: 31922,
        pubkey: ME,
        title: 'Conference',
        start: ALL_DAY_START,
        dTag: 'ad',
        participants: [],
        hashtags: [],
        references: [],
        originalEvent: rawEvent,
        ...extra
      },
      rawEvent
    };
  }

  it('single-day: shows the event day, not the day before', () => {
    render(CalendarEventDetailView, { props: allDayFixture() });
    const body = document.body.textContent || '';
    expect(body).toMatch(/\b3\b/);
    expect(body).not.toMatch(/\b2\b/);
  });

  it('multi-day: shows both the correct start and end days', () => {
    render(CalendarEventDetailView, { props: allDayFixture({ end: ALL_DAY_END }) });
    const body = document.body.textContent || '';
    expect(body).toMatch(/\b3\b/);
    expect(body).toMatch(/\b5\b/);
  });
});
