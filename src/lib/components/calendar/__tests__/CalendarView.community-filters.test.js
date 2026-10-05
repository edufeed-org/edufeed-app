// @ts-nocheck
/**
 * Community calendars get the same filter bar as /calendar (GitHub #2):
 * search, tags and people narrow the community's events client-side. The
 * relay picker is hidden there — community events come from the community's
 * own relays, not from the calendar relays the picker lists.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { NEVER } from 'rxjs';

const h = vi.hoisted(() => ({
  /** @type {Record<string, any>} */
  captured: {},
  /** @type {any[]} */
  events: [],
  pageUrl: 'http://localhost/c/npub1community?view=calendar',
  replaceState: /** @type {any} */ (null),
  searchLoader: /** @type {any} */ (null)
}));

/** A child-component stub that records the props object it was mounted with. */
function stub(name) {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ props) => {
      h.captured[name] = props;
    }
  };
}

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {(v: any) => void} */ cb) => {
      cb({ url: new URL(h.pageUrl) });
      return () => {};
    }
  }
}));
vi.mock('$app/navigation', () => {
  h.replaceState = vi.fn();
  return { afterNavigate: vi.fn(), replaceState: h.replaceState, goto: vi.fn() };
});
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: () => NEVER, timeline: () => NEVER },
  pool: {}
}));
vi.mock('$lib/loaders/calendar.js', () => ({
  communityCalendarTimelineLoader: () => () => NEVER,
  createDateRangeCalendarLoader: () => () => NEVER,
  createRelayFilteredCalendarLoader: () => () => NEVER,
  calendarEventReferencesLoader: () => () => NEVER,
  channelCalendarsLoader: () => () => NEVER,
  calendarTimelineLoader: () => () => NEVER,
  prefetchCalendarData: () => {}
}));
vi.mock('$lib/loaders/targeted-publications.js', () => ({
  communityTargetedPublicationsLoader: () => () => NEVER
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: () => NEVER,
  userDeletionLoader: () => () => NEVER,
  addressLoader: () => NEVER
}));
vi.mock('$lib/loaders/calendar-search.js', () => {
  h.searchLoader = vi.fn(() => NEVER);
  return { calendarSearchLoader: h.searchLoader, MIN_QUERY_LENGTH: 2 };
});
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/stores/author-deletions.svelte.js', () => ({ useAuthorDeletions: () => {} }));
vi.mock('$lib/helpers/relay-helper.js', async (orig) => ({
  ...(await orig()),
  getCalendarRelays: () => ['wss://calendar.example/'],
  getAllLookupRelays: () => []
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  relayUpdateSignal: {
    subscribe: (/** @type {(v: any) => void} */ cb) => {
      cb(0);
      return () => {};
    }
  }
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { calendar: { weekStartDay: 1 } }
}));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  parseDirectPubkeys: (/** @type {string[]} */ list) => list,
  applyCuratedFilter: (/** @type {any} */ f) => f
}));
vi.mock('$lib/models/global-calendar-event.js', () => ({ GlobalCalendarEventModel: {} }));
vi.mock('$lib/models', () => ({
  PersonalCalendarEventsModel: {},
  CalendarEventRangeModel: {},
  CommunityCalendarEventModel: {}
}));
vi.mock('$lib/loaders/calendar-event-loader.svelte.js', async (orig) => ({
  ...(await orig()),
  useCalendarEventLoader: (/** @type {any} */ opts) => ({
    loadByCommunity: () => {
      opts.onEventsUpdate(h.events);
      opts.onLoadingChange(false);
    },
    cleanup: () => {}
  })
}));

vi.mock('../CalendarNavigation.svelte', () => stub('CalendarNavigation'));
vi.mock('../CalendarGrid.svelte', () => stub('CalendarGrid'));
vi.mock('../TopPublishersFilter.svelte', () => stub('TopPublishersFilter'));
vi.mock('../CalendarDropdown.svelte', () => stub('CalendarDropdown'));
vi.mock('../CalendarFilterBar.svelte', () => stub('CalendarFilterBar'));
vi.mock('../CalendarFilterDrawer.svelte', () => stub('CalendarFilterDrawer'));
vi.mock('../FeaturedAuthors.svelte', () => stub('FeaturedAuthors'));
vi.mock('../CalendarEventsList.svelte', () => stub('CalendarEventsList'));
vi.mock('../AddToCalendarButton.svelte', () => stub('AddToCalendarButton'));
vi.mock('../CalendarMapView.svelte', () => stub('CalendarMapView'));
vi.mock('$lib/components/community/layout/CompactCommunityHeader.svelte', () =>
  stub('CompactCommunityHeader')
);

const { calendarFilters } = await import('$lib/stores/calendar-filters.svelte.js');
const { default: CalendarView } = await import('../CalendarView.svelte');

const COMMUNITY = 'c'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

/** @param {string} id @param {string} pubkey @param {string} title @param {string[]} hashtags */
function calEvent(id, pubkey, title, hashtags) {
  return { id: id.padEnd(64, '0'), kind: 31923, pubkey, title, hashtags, description: '' };
}

const yoga = calEvent('1', ALICE, 'Yoga im Park', ['sport']);
const meetup = calEvent('2', BOB, 'Nostr Meetup', ['nostr']);
const workshop = calEvent('3', BOB, 'OER Workshop', ['oer', 'nostr']);

// The community URL's ?view=calendar doubles as the presentation mode, so a
// community calendar renders the grid; read whichever event view is mounted.
const listedTitles = () =>
  (h.captured.CalendarGrid ?? h.captured.CalendarEventsList).events.map(
    (/** @type {any} */ e) => e.title
  );

function renderCommunity() {
  const result = render(CalendarView, {
    props: { communityPubkey: COMMUNITY, communityMode: true }
  });
  flushSync();
  return result;
}

describe('CalendarView community mode filters (GitHub #2)', () => {
  beforeEach(() => {
    for (const key of Object.keys(h.captured)) delete h.captured[key];
    h.events = [yoga, meetup, workshop];
    h.pageUrl = 'http://localhost/c/npub1community?view=calendar';
    h.replaceState.mockClear();
    h.searchLoader.mockClear();
    calendarFilters.reset();
  });

  it('renders the filter bar and drawer, without the relay picker', () => {
    renderCommunity();
    expect(h.captured.CalendarFilterBar).toBeDefined();
    expect(h.captured.CalendarFilterBar.showRelays).toBe(false);
    expect(h.captured.CalendarFilterDrawer).toBeDefined();
    expect(h.captured.CalendarFilterDrawer.showRelays).toBe(false);
    // The community heading's subscribe button stays; the personal calendar
    // picker never belongs to a community calendar.
    expect(h.captured.AddToCalendarButton).toBeDefined();
    expect(h.captured.CalendarDropdown).toBeUndefined();
  });

  it('hands the community events to the filter bar for tag suggestions', () => {
    renderCommunity();
    expect(h.captured.CalendarFilterBar.validEvents).toHaveLength(3);
  });

  it('a search query narrows the community events', () => {
    renderCommunity();
    expect(listedTitles()).toHaveLength(3);
    calendarFilters.setSearchQuery('yoga');
    flushSync();
    expect(listedTitles()).toEqual(['Yoga im Park']);
  });

  it('a tag filter narrows the community events', () => {
    renderCommunity();
    calendarFilters.setSelectedTags(['nostr']);
    flushSync();
    expect(listedTitles()).toEqual(['Nostr Meetup', 'OER Workshop']);
  });

  it('the people filter narrows the community events client-side', () => {
    renderCommunity();
    calendarFilters.setUserFollowPubkeys([ALICE]);
    calendarFilters.setOnlyFollowsMode('follows');
    flushSync();
    expect(listedTitles()).toEqual(['Yoga im Park']);
  });

  it('ignores and clears a relay selection (community relays are fixed)', () => {
    h.pageUrl = 'http://localhost/c/npub1community?view=calendar&relays=wss://calendar.example/';
    renderCommunity();
    expect(calendarFilters.selectedRelays).toEqual([]);
    expect(listedTitles()).toHaveLength(3);
  });

  it('does not inherit filters left in the store by another calendar', () => {
    calendarFilters.setSearchQuery('stale');
    calendarFilters.setSelectedTags(['sport']);
    renderCommunity();
    expect(calendarFilters.searchQuery).toBe('');
    expect(calendarFilters.selectedTags).toEqual([]);
    expect(listedTitles()).toHaveLength(3);
  });

  it('restores filters from a shared community calendar URL', () => {
    h.pageUrl = 'http://localhost/c/npub1community?view=calendar&tags=oer';
    renderCommunity();
    expect(listedTitles()).toEqual(['OER Workshop']);
  });

  it('mirrors community filters into the URL, keeping ?view=calendar', () => {
    window.history.replaceState({}, '', '/c/npub1community?view=calendar');
    renderCommunity();
    calendarFilters.setSearchQuery('yoga');
    flushSync();
    const urls = h.replaceState.mock.calls.map((/** @type {any[]} */ c) => String(c[0]));
    const last = new URL(urls.at(-1));
    expect(last.searchParams.get('search')).toBe('yoga');
    expect(last.searchParams.get('view')).toBe('calendar');
  });

  it('does not run the global NIP-50 search loader for a community', async () => {
    vi.useFakeTimers();
    try {
      renderCommunity();
      calendarFilters.setSearchQuery('yoga');
      flushSync();
      vi.advanceTimersByTime(500);
      expect(h.searchLoader).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CalendarView global mode keeps the relay picker', () => {
  beforeEach(() => {
    for (const key of Object.keys(h.captured)) delete h.captured[key];
    h.pageUrl = 'http://localhost/calendar';
    calendarFilters.reset();
  });

  it('renders the filter bar with relays and the calendar picker', () => {
    render(CalendarView, { props: { globalMode: true } });
    flushSync();
    expect(h.captured.CalendarFilterBar.showRelays).toBe(true);
    expect(h.captured.CalendarDropdown).toBeDefined();
  });
});
