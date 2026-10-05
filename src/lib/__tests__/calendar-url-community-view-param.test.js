// @ts-nocheck
/**
 * Community calendar presentation param.
 *
 * The community route owns `?view=` (it selects the community SECTION, e.g.
 * `?view=calendar`). The calendar's presentation mode (list/grid/map) must
 * therefore live in its own param (`cview`) in community mode — otherwise a
 * community calendar always opened as grid (`view=calendar` read as the
 * presentation) and switching to list/map wrote `view=list|map`, which the
 * community layout rejects and falls back to the home section.
 *
 * Global/author calendars keep `?view=list|calendar|map` unchanged.
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
  calendarViewParamName,
  toCalendarViewParams,
  COMMUNITY_CALENDAR_VIEW_PARAM
} from '$lib/helpers/urlParams.js';
import {
  syncInitialUrlState,
  createUrlSyncHandler
} from '$lib/loaders/calendar-event-loader.svelte.js';

/** Run syncInitialUrlState and return the resolved presentation mode. */
function initialPresentation(query, communityMode) {
  let presentation;
  syncInitialUrlState(
    toCalendarViewParams(new URLSearchParams(query), communityMode),
    (m) => (presentation = m),
    () => {}
  );
  return presentation;
}

describe('calendarViewParamName', () => {
  it('uses `view` outside communities and `cview` inside', () => {
    expect(calendarViewParamName(false)).toBe('view');
    expect(calendarViewParamName(true)).toBe(COMMUNITY_CALENDAR_VIEW_PARAM);
    expect(COMMUNITY_CALENDAR_VIEW_PARAM).toBe('cview');
  });
});

describe('community calendar presentation (syncInitialUrlState)', () => {
  it('ignores the community section ?view=calendar and defaults to list', () => {
    expect(initialPresentation('view=calendar', true)).toBe('list');
  });

  it('reads the presentation from ?cview=', () => {
    expect(initialPresentation('view=calendar&cview=calendar', true)).toBe('calendar');
    expect(initialPresentation('view=calendar&cview=map', true)).toBe('map');
    expect(initialPresentation('view=calendar&cview=list', true)).toBe('list');
  });

  it('does not mutate the original params (community section survives)', () => {
    const params = new URLSearchParams('view=calendar&cview=map');
    toCalendarViewParams(params, true);
    expect(params.get('view')).toBe('calendar');
    expect(params.get('cview')).toBe('map');
  });
});

describe('global/author calendar presentation keeps ?view=', () => {
  it('reads ?view=list|calendar|map as before', () => {
    expect(initialPresentation('view=calendar', false)).toBe('calendar');
    expect(initialPresentation('view=map', false)).toBe('map');
    expect(initialPresentation('view=list', false)).toBe('list');
    expect(initialPresentation('', false)).toBe('list');
  });

  it('ignores a stray ?cview= outside communities', () => {
    expect(initialPresentation('cview=map', false)).toBe('list');
  });
});

describe('community calendar presentation (createUrlSyncHandler)', () => {
  it('maps navigation URLs through the community param', () => {
    let presentation;
    const handler = createUrlSyncHandler(
      (m) => (presentation = m),
      () => {}
    );
    const url = new URL('http://localhost/c/npub1x?view=calendar');
    handler({ to: { url: { searchParams: toCalendarViewParams(url.searchParams, true) } } });
    expect(presentation).toBe('list');

    const url2 = new URL('http://localhost/c/npub1x?view=calendar&cview=calendar');
    handler({ to: { url: { searchParams: toCalendarViewParams(url2.searchParams, true) } } });
    expect(presentation).toBe('calendar');
  });
});
