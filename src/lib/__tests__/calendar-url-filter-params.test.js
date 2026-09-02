// @ts-nocheck
/**
 * Calendar filter-in-URL tests (shareable filtered views)
 *
 * Selected filters must be encoded as URL query params so a filtered view can
 * be shared/bookmarked, and restored from the URL on page load:
 *   - applyCalendarFilterState: store state -> URLSearchParams (central writer)
 *   - parseCalendarFilters: URL -> parsed filter state (incl. people/featured/
 *     hidden/publishers)
 *   - syncInitialUrlState: URL -> calendarFilters store (restore on load)
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

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

import { parseCalendarFilters, applyCalendarFilterState } from '$lib/helpers/urlParams.js';
import { syncInitialUrlState } from '$lib/loaders/calendar-event-loader.svelte.js';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

/** Full filter snapshot with everything off (the defaults). */
function emptyState() {
  return {
    tags: [],
    relays: [],
    followListIds: [],
    search: '',
    featured: [],
    people: 'off',
    hidden: [],
    publishers: []
  };
}

describe('applyCalendarFilterState (state -> URL)', () => {
  it('writes all active filters as query params', () => {
    const next = applyCalendarFilterState(new URLSearchParams(), {
      tags: ['nostr', 'oer'],
      relays: ['wss://relay.example.com'],
      followListIds: ['nip02-contacts'],
      search: 'conference',
      featured: [PK_A],
      people: 'follows',
      hidden: [PK_B],
      publishers: [PK_A]
    });
    expect(next.getAll('tags')).toEqual(['nostr', 'oer']);
    expect(next.getAll('relays')).toEqual(['wss://relay.example.com']);
    expect(next.getAll('authors')).toEqual(['nip02-contacts']);
    expect(next.get('search')).toBe('conference');
    expect(next.getAll('featured')).toEqual([PK_A]);
    expect(next.get('people')).toBe('follows');
    expect(next.getAll('hidden')).toEqual([PK_B]);
    expect(next.getAll('publishers')).toEqual([PK_A]);
  });

  it('omits every param at its default so the URL stays clean', () => {
    const next = applyCalendarFilterState(new URLSearchParams(), emptyState());
    expect(next.toString()).toBe('');
  });

  it('omits whitespace-only search queries', () => {
    const next = applyCalendarFilterState(new URLSearchParams(), {
      ...emptyState(),
      search: '   '
    });
    expect(next.get('search')).toBeNull();
  });

  it('preserves unrelated params and clears stale filter params', () => {
    const current = new URLSearchParams(
      'view=calendar&period=week&date=2026-10-01&tags=old&people=featured'
    );
    const next = applyCalendarFilterState(current, {
      ...emptyState(),
      tags: ['fresh']
    });
    expect(next.get('view')).toBe('calendar');
    expect(next.get('period')).toBe('week');
    expect(next.get('date')).toBe('2026-10-01');
    expect(next.getAll('tags')).toEqual(['fresh']);
    expect(next.get('people')).toBeNull();
  });

  it('does not mutate the input params', () => {
    const current = new URLSearchParams('tags=old');
    applyCalendarFilterState(current, emptyState());
    expect(current.get('tags')).toBe('old');
  });

  it('roundtrips through parseCalendarFilters', () => {
    const state = {
      tags: ['nostr'],
      relays: ['wss://relay.example.com'],
      followListIds: ['nip02-contacts'],
      search: 'edu',
      featured: [PK_A],
      people: 'featured',
      hidden: [PK_B],
      publishers: [PK_A]
    };
    const parsed = parseCalendarFilters(applyCalendarFilterState(new URLSearchParams(), state));
    expect(parsed.tags).toEqual(state.tags);
    expect(parsed.relays).toEqual(state.relays);
    expect(parsed.authors).toEqual(state.followListIds);
    expect(parsed.search).toBe(state.search);
    expect(parsed.featured).toEqual(state.featured);
    expect(parsed.people).toBe(state.people);
    expect(parsed.hidden).toEqual(state.hidden);
    expect(parsed.publishers).toEqual(state.publishers);
  });
});

describe('parseCalendarFilters new filter params', () => {
  it('parses featured/people/hidden/publishers', () => {
    const parsed = parseCalendarFilters(
      new URLSearchParams(`featured=${PK_A}&people=follows&hidden=${PK_B}&publishers=${PK_A}`)
    );
    expect(parsed.featured).toEqual([PK_A]);
    expect(parsed.people).toBe('follows');
    expect(parsed.hidden).toEqual([PK_B]);
    expect(parsed.publishers).toEqual([PK_A]);
  });

  it('defaults to off/empty when absent', () => {
    const parsed = parseCalendarFilters(new URLSearchParams());
    expect(parsed.featured).toEqual([]);
    expect(parsed.people).toBe('off');
    expect(parsed.hidden).toEqual([]);
    expect(parsed.publishers).toEqual([]);
  });
});

describe('URL -> store restore (syncInitialUrlState)', () => {
  beforeEach(() => {
    calendarFilters.reset();
  });

  const noop = () => {};

  it('restores people mode, featured, hidden, and publishers', () => {
    syncInitialUrlState(
      new URLSearchParams(`featured=${PK_A}&people=featured&hidden=${PK_B}&publishers=${PK_A}`),
      noop,
      noop,
      noop
    );
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([PK_A]);
    expect(calendarFilters.onlyFollowsMode).toBe('featured');
    expect(calendarFilters.hiddenAuthorPubkeys).toEqual([PK_B]);
    expect(calendarFilters.selectedAuthorPubkeys).toEqual([PK_A]);
  });

  it('ignores invalid people values', () => {
    syncInitialUrlState(new URLSearchParams('people=bogus'), noop, noop, noop);
    expect(calendarFilters.onlyFollowsMode).toBe('off');
  });

  it('drops non-hex pubkeys and dedupes', () => {
    syncInitialUrlState(
      new URLSearchParams(
        `featured=${PK_A}&featured=${PK_A}&featured=not-a-pubkey&hidden=<script>`
      ),
      noop,
      noop,
      noop
    );
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([PK_A]);
    expect(calendarFilters.hiddenAuthorPubkeys).toEqual([]);
  });

  it('clears restored filters when params are absent', () => {
    calendarFilters.setSelectedFeaturedAuthors([PK_A]);
    calendarFilters.setOnlyFollowsMode('follows');
    calendarFilters.toggleHiddenAuthor(PK_B);
    calendarFilters.toggleSelectedAuthor(PK_A);
    syncInitialUrlState(new URLSearchParams(), noop, noop, noop);
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
    expect(calendarFilters.onlyFollowsMode).toBe('off');
    expect(calendarFilters.hiddenAuthorPubkeys).toEqual([]);
    expect(calendarFilters.selectedAuthorPubkeys).toEqual([]);
  });
});
