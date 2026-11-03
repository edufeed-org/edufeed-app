// @ts-nocheck
/**
 * Date-label bugs reported west of UTC (issue a798c7d2):
 *
 * M1. 31922 (date-based) events are UTC-midnight timestamps. Formatting them
 *     without `{ utc: true }` renders the previous calendar day for a viewer
 *     west of UTC (e.g. America/New_York). The grid already gets this right;
 *     the card did not.
 * L1. A 31923 (timed) event whose end lands exactly on local midnight showed
 *     as a two-day event: `toDateString()` on the exclusive end rolls over to
 *     the next day. Comparing `end - 1s` instead keeps it single-day.
 *
 * Unlike CalendarEventCard.test.js, this file does NOT mock
 * `$lib/helpers/calendar.js` — it exercises the real `formatCalendarDate` so
 * the UTC/local date math is actually under test.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import CalendarEventCard from '../calendar/CalendarEventCard.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseForHash: () => () => null,
  useLicenseStatus: () => () => ({ event: null, status: 'loading' })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { calendar: { locale: 'de-DE', timeFormat: '24h', weekStartDay: 1 } }
}));
vi.mock('$lib/stores/calendar-event-rsvps.svelte.js', () => ({
  useCalendarEventRsvps: () => ({ rsvps: [], loading: false })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));
vi.mock('$lib/helpers/rsvpUtils.js', () => ({
  transformRsvps: () => ({ accepted: [], tentative: [], declined: [], totalCount: 0 })
}));
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/AttendeeIndicator.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/LocationLink.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

const ORIGINAL_TZ = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.restoreAllMocks();
});

const PUBKEY = 'b'.repeat(64);

function allDayFixture({ start, end = null, compact = false, variant = 'card' } = {}) {
  return {
    event: {
      id: 'a'.repeat(64),
      pubkey: PUBKEY,
      kind: 31922,
      title: 'All Day Workshop',
      start,
      end,
      hashtags: [],
      createdAt: start,
      originalEvent: {
        id: 'a'.repeat(64),
        kind: 31922,
        pubkey: PUBKEY,
        tags: [['d', 'workshop-1']],
        created_at: start
      }
    },
    compact,
    variant
  };
}

// 2026-11-03 as a NIP-52 date-based event: UTC midnight.
const NOV_3_UTC_MIDNIGHT = Date.UTC(2026, 10, 3) / 1000;
const NOV_5_UTC_MIDNIGHT = Date.UTC(2026, 10, 5) / 1000;

describe('CalendarEventCard — all-day dates west of UTC (M1)', () => {
  it('card variant: shows the event day, not the day before (3, not 2)', () => {
    const { container } = render(CalendarEventCard, {
      props: allDayFixture({ start: NOV_3_UTC_MIDNIGHT })
    });
    const when = container.querySelector('[data-testid="event-card-when"]');
    expect(when?.textContent).toMatch(/\b3\b/);
    expect(when?.textContent).not.toMatch(/\b2\b/);
  });

  it('list variant: shows the event day, not the day before', () => {
    const { container } = render(CalendarEventCard, {
      props: allDayFixture({ start: NOV_3_UTC_MIDNIGHT, variant: 'list' })
    });
    expect(container.textContent).toMatch(/\b3\b/);
  });

  it('compact variant multi-day date line uses the correct start and end days', () => {
    const { container } = render(CalendarEventCard, {
      props: allDayFixture({ start: NOV_3_UTC_MIDNIGHT, end: NOV_5_UTC_MIDNIGHT, compact: true })
    });
    expect(container.textContent).toMatch(/\b3\b/);
    expect(container.textContent).toMatch(/\b5\b/);
    expect(container.textContent).not.toMatch(/\b2\b/);
    expect(container.textContent).not.toMatch(/\b4\b/);
  });

  it('card variant multi-day date line uses the correct start and end days', () => {
    const { container } = render(CalendarEventCard, {
      props: allDayFixture({ start: NOV_3_UTC_MIDNIGHT, end: NOV_5_UTC_MIDNIGHT })
    });
    const when = container.querySelector('[data-testid="event-card-when"]');
    expect(when?.textContent).toMatch(/\b3\b/);
    expect(when?.textContent).toMatch(/\b5\b/);
  });
});

describe('CalendarEventCard — timed event ending exactly at local midnight (L1)', () => {
  function timedMidnightFixture() {
    // 2026-11-20 18:00 America/New_York -> 2026-11-21 00:00 America/New_York
    // (EST, UTC-5 in November). Exclusive end lands exactly on local midnight.
    const start = Date.UTC(2026, 10, 20, 23, 0) / 1000; // 18:00 EST
    const end = Date.UTC(2026, 10, 21, 5, 0) / 1000; // 00:00 EST next day
    return {
      event: {
        id: 'c'.repeat(64),
        pubkey: PUBKEY,
        kind: 31923,
        title: 'Late Session',
        start,
        end,
        hashtags: [],
        createdAt: start,
        originalEvent: {
          id: 'c'.repeat(64),
          kind: 31923,
          pubkey: PUBKEY,
          tags: [['d', 'late-1']],
          created_at: start
        }
      }
    };
  }

  it('is not treated as multi-day (no secondary-border / two dates)', () => {
    const { container } = render(CalendarEventCard, { props: timedMidnightFixture() });
    const card = container.querySelector('.calendar-event-card');
    expect(card?.classList.contains('border-l-secondary')).toBe(false);
    const when = container.querySelector('[data-testid="event-card-when"]');
    // Only one date should appear on the date line (no "start - end" span).
    expect(when?.textContent?.match(/\bNov\b/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
