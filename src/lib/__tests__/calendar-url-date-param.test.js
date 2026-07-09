// @ts-nocheck
/**
 * Calendar date-in-URL tests (edufeed-app#30)
 *
 * The viewed time range must survive reload/sharing: /calendar?date=2026-10-01
 * restores the calendar to that date. Dates are LOCAL calendar days (never
 * UTC-converted — a viewer in UTC+2 at 00:30 must not land on yesterday).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

// calendar-event-loader pulls window-dependent infrastructure at module scope
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: {}, pool: {} }));
vi.mock('$lib/loaders/calendar.js', () => ({
  calendarTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('$lib/loaders/targeted-publications.js', () => ({
  communityTargetedPublicationsLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('$lib/loaders/base.js', () => ({
  userDeletionLoader: () => () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  addressLoader: () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  applyCuratedFilter: (f) => f
}));
vi.mock('$lib/models', () => ({ CommunityCalendarEventModel: {} }));

import {
  parseCalendarFilters,
  buildCalendarURL,
  formatDateParam,
  parseDateParam
} from '$lib/helpers/urlParams.js';
import {
  syncInitialUrlState,
  createUrlSyncHandler
} from '$lib/loaders/calendar-event-loader.svelte.js';

describe('date param codec', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(formatDateParam(new Date(2026, 9, 1))).toBe('2026-10-01');
    expect(formatDateParam(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('parses YYYY-MM-DD into a LOCAL date', () => {
    const d = parseDateParam('2026-10-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it('rejects garbage and impossible dates', () => {
    expect(parseDateParam('')).toBeNull();
    expect(parseDateParam('not-a-date')).toBeNull();
    expect(parseDateParam('2026-13-45')).toBeNull();
    expect(parseDateParam('2026-02-30')).toBeNull();
  });

  it('roundtrips', () => {
    const d = new Date(2026, 6, 9);
    expect(parseDateParam(formatDateParam(d)).getTime()).toBe(d.getTime());
  });
});

describe('parseCalendarFilters / buildCalendarURL date support', () => {
  it('parses the date param', () => {
    const filters = parseCalendarFilters(new URLSearchParams('view=calendar&date=2026-10-01'));
    expect(filters.date).toBe('2026-10-01');
  });

  it('builds URLs including the date', () => {
    const url = buildCalendarURL({ view: 'calendar', period: 'week', date: '2026-10-01' });
    expect(url).toContain('date=2026-10-01');
  });

  it('omits the date when unset', () => {
    expect(buildCalendarURL({ view: 'calendar' })).not.toContain('date=');
  });
});

describe('URL -> state sync applies the date', () => {
  it('syncInitialUrlState reports a valid date param', () => {
    const onDate = vi.fn();
    syncInitialUrlState(
      new URLSearchParams('view=calendar&period=week&date=2026-10-01'),
      () => {},
      () => {},
      onDate
    );
    const d = onDate.mock.calls[0][0];
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(1);
  });

  it('syncInitialUrlState skips missing/invalid dates', () => {
    const onDate = vi.fn();
    syncInitialUrlState(
      new URLSearchParams('view=calendar'),
      () => {},
      () => {},
      onDate
    );
    syncInitialUrlState(
      new URLSearchParams('date=bogus'),
      () => {},
      () => {},
      onDate
    );
    expect(onDate).not.toHaveBeenCalled();
  });

  it('createUrlSyncHandler reports the date on navigation', () => {
    const onDate = vi.fn();
    const handler = createUrlSyncHandler(
      () => {},
      () => {},
      onDate
    );
    handler({ to: { url: new URL('http://x.test/calendar?date=2026-07-09') } });
    expect(onDate.mock.calls[0][0].getDate()).toBe(9);
  });
});
