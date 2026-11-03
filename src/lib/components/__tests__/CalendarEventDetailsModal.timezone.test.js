// @ts-nocheck
/**
 * NIP-52 start_tzid/end_tzid in the event preview modal: times are shown in
 * the event's zone next to its label, plus the viewer's own time when that
 * differs (see CalendarEventDetailView.timezone.test.js).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const ME = 'a'.repeat(64);

const h = vi.hoisted(() => ({ modal: null, goto: null }));

vi.mock('$app/navigation', () => ({ goto: (...a) => h.goto(...a) }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
// Pin the "today"/"tomorrow" compact-header labels so the M1 test below does
// not depend on the active paraglide locale; every other message is real.
vi.mock('$lib/paraglide/messages', async () => {
  const actual = await vi.importActual('$lib/paraglide/messages');
  return {
    ...actual,
    event_details_today: () => 'TODAY_LABEL',
    event_details_tomorrow: () => 'TOMORROW_LABEL'
  };
});
vi.mock('$lib/stores/modal.svelte.js', () => ({
  get modalStore() {
    return h.modal;
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: ME } }
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: () => () => null
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock(
  '$lib/components/calendar/EventDebugInfo.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/EventLocationMap.svelte',
  () => import('./fixtures/EventLocationMapStub.svelte')
);
vi.mock(
  '$lib/components/shared/MarkdownRenderer.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/PersonalCalendarShare.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/CommunityShare.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/reactions/ReactionBar.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/ProfileCard.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/NamedParticipant.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/EventContextMenu.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/HeroImage.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/shared/ImageLicenseOverlay.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);

const { default: CalendarEventDetailsModal } = await import(
  '$lib/components/calendar/CalendarEventDetailsModal.svelte'
);

function open(event) {
  h.modal = {
    activeModal: 'eventDetails',
    modalProps: { event },
    openModal: vi.fn(),
    closeModal: vi.fn()
  };
  return render(CalendarEventDetailsModal);
}

const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;

// 2026-05-04 10:00 New York = 16:00 Berlin; ends 11:30 New York = 17:30 Berlin
const START = Date.UTC(2026, 4, 4, 14, 0) / 1000;
const END = Date.UTC(2026, 4, 4, 15, 30) / 1000;

function fixture(overrides = {}) {
  return {
    id: 'e'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 31923,
    title: 'Webinar',
    start: START,
    end: END,
    location: '',
    hashtags: [],
    participants: [],
    references: [],
    createdAt: 1_700_000_000,
    dTag: 'event-1',
    originalEvent: null,
    ...overrides
  };
}

describe('CalendarEventDetailsModal — event time zone', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    h.goto = vi.fn();
    // The worker's zone cannot be switched at runtime; pin the viewer's zone
    // the way getCurrentTimezone() reads it.
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function () {
      return { ...realResolved.call(this), timeZone: 'Europe/Berlin' };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the event-zone time with its label and the viewer's time beside it", () => {
    open(fixture({ startTimezone: 'America/New_York', endTimezone: 'America/New_York' }));
    const start = screen.getByTestId('event-start-time').textContent;
    expect(start).toContain('10:00');
    expect(start).toContain('America/New_York');
    expect(start).toContain('(16:00 Europe/Berlin)');
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('(17:30 Europe/Berlin)');
  });

  it("labels the end with start_tzid's zone when end_tzid is missing", () => {
    open(fixture({ startTimezone: 'America/New_York' }));
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('America/New_York');
  });
});

// M1: 31922 (date-based) timestamps are UTC midnight. Formatting them
// without `{ utc: true }` renders the day before for a viewer west of UTC —
// including the compact header's "today"/"tomorrow" date, which read the
// UTC-midnight instant with local getters.
describe('CalendarEventDetailsModal — all-day dates west of UTC (M1)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    h.goto = vi.fn();
    process.env.TZ = 'America/New_York';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 2026-11-03 as a NIP-52 date-based event: UTC midnight.
  const ALL_DAY_START = Date.UTC(2026, 10, 3) / 1000;
  const ALL_DAY_END = Date.UTC(2026, 10, 5) / 1000;

  function allDayFixture(overrides = {}) {
    return fixture({
      kind: 31922,
      start: ALL_DAY_START,
      end: null,
      originalEvent: null,
      ...overrides
    });
  }

  it('date-and-time card: single-day shows the event day, not the day before', () => {
    open(allDayFixture());
    const body = document.body.textContent || '';
    expect(body).toMatch(/\b3\b/);
    expect(body).not.toMatch(/\b2\b/);
  });

  it('date-and-time card: multi-day shows both the correct start and end days', () => {
    open(allDayFixture({ end: ALL_DAY_END }));
    const body = document.body.textContent || '';
    expect(body).toMatch(/\b3\b/);
    expect(body).toMatch(/\b5\b/);
  });

  it('compact header date: labels the event "today" by its UTC calendar day, not a day early', () => {
    vi.useFakeTimers();
    // Noon UTC = 07:00 EST, still 2026-11-03 in both UTC and America/New_York.
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 3, 12, 0)));
    open(allDayFixture());
    expect(document.body.textContent).toContain('TODAY_LABEL');
  });
});
