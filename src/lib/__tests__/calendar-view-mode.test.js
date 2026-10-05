// @ts-nocheck
/**
 * Calendar default period selection (GitHub edufeed-org/edufeed-app#3)
 *
 * The list view used to open on a single month, so "Meine Veranstaltungen"
 * never showed all upcoming + past events at once. In bounded contexts
 * (author, a specific calendar, community) the list now defaults to 'all';
 * the global calendar keeps 'month' because an undated query there pulls
 * every relay's whole calendar history. An explicitly picked period always wins,
 * and the grid views (calendar/map) are unchanged.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

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

import { resolveCalendarViewState, listDefaultsToAllFor } from '$lib/helpers/calendar-view-mode.js';
import {
  syncInitialUrlState,
  createUrlSyncHandler
} from '$lib/loaders/calendar-event-loader.svelte.js';

const params = (s = '') => new URLSearchParams(s);

describe('resolveCalendarViewState', () => {
  describe('bounded context (list defaults to all)', () => {
    const opts = { listDefaultsToAll: true };

    it('defaults the list view to all when no period is given', () => {
      expect(resolveCalendarViewState(params(), opts)).toEqual({
        presentationView: 'list',
        period: 'all'
      });
      expect(resolveCalendarViewState(params('view=list'), opts).period).toBe('all');
    });

    it('keeps an explicitly picked period in the list view', () => {
      expect(resolveCalendarViewState(params('period=month'), opts).period).toBe('month');
      expect(resolveCalendarViewState(params('view=list&period=week'), opts).period).toBe('week');
    });

    it('leaves the grid views on month', () => {
      expect(resolveCalendarViewState(params('view=calendar'), opts)).toEqual({
        presentationView: 'calendar',
        period: 'month'
      });
      expect(resolveCalendarViewState(params('view=map'), opts).period).toBe('month');
    });

    it('never shows all in the calendar grid', () => {
      expect(resolveCalendarViewState(params('view=calendar&period=all'), opts).period).toBe(
        'month'
      );
    });

    it('falls back to the context default for an invalid period', () => {
      expect(resolveCalendarViewState(params('period=bogus'), opts).period).toBe('all');
      expect(resolveCalendarViewState(params('view=calendar&period=bogus'), opts).period).toBe(
        'month'
      );
    });
  });

  describe('global calendar (list stays on month)', () => {
    it('defaults to month when no period is given', () => {
      expect(resolveCalendarViewState(params())).toEqual({
        presentationView: 'list',
        period: 'month'
      });
      expect(resolveCalendarViewState(params(), { listDefaultsToAll: false }).period).toBe('month');
    });

    it('still honours an explicit all', () => {
      expect(resolveCalendarViewState(params('period=all')).period).toBe('all');
    });
  });
});

describe('listDefaultsToAllFor', () => {
  it('is true for author mode ("Meine Veranstaltungen")', () => {
    expect(listDefaultsToAllFor({ authorPubkey: 'abc', globalMode: false })).toBe(true);
  });

  it('is true for a specific calendar', () => {
    expect(listDefaultsToAllFor({ calendar: { id: 'x' } })).toBe(true);
  });

  it('is true for a community calendar', () => {
    expect(listDefaultsToAllFor({ communityMode: true, communityPubkey: 'abc' })).toBe(true);
  });

  it('is false for the global calendar', () => {
    expect(listDefaultsToAllFor({ globalMode: true })).toBe(false);
    expect(listDefaultsToAllFor({})).toBe(false);
  });
});

describe('URL sync applies the context default', () => {
  const noop = () => {};

  it('syncInitialUrlState lands the list on all in a bounded context', () => {
    const onPeriod = vi.fn();
    syncInitialUrlState(params(), noop, onPeriod, noop, { listDefaultsToAll: () => true });
    expect(onPeriod).toHaveBeenCalledWith('all');
  });

  it('syncInitialUrlState keeps month without the option (global calendar)', () => {
    const onPeriod = vi.fn();
    syncInitialUrlState(params(), noop, onPeriod, noop);
    expect(onPeriod).toHaveBeenCalledWith('month');
  });

  it('createUrlSyncHandler switches to all when the user changes to the list view', () => {
    const onView = vi.fn();
    const onPeriod = vi.fn();
    const handler = createUrlSyncHandler(onView, onPeriod, noop, {
      listDefaultsToAll: () => true
    });
    handler({ to: { url: new URL('http://x/calendar/author/abc?view=list') } });
    expect(onView).toHaveBeenCalledWith('list');
    expect(onPeriod).toHaveBeenCalledWith('all');

    handler({ to: { url: new URL('http://x/calendar/author/abc?view=calendar') } });
    expect(onPeriod).toHaveBeenLastCalledWith('month');

    handler({ to: { url: new URL('http://x/calendar/author/abc?view=list&period=week') } });
    expect(onPeriod).toHaveBeenLastCalledWith('week');
  });
});
