// @ts-nocheck
/**
 * Channel meetings (NIP-52 events h-tagged with a channel id) share the
 * eventStore with everything else, but must never surface in the generic
 * calendar views and feeds — from there the normal edit/share paths would
 * publish them through the outbox (M3 review, controller ruling).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, NEVER } from 'rxjs';

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  return { eventStore, pool: { subscription: () => NEVER } };
});
vi.mock('$lib/loaders/calendar.js', () => ({ calendarTimelineLoader: () => () => NEVER }));
vi.mock('$lib/loaders/targeted-publications.js', () => ({
  communityTargetedPublicationsLoader: () => () => NEVER
}));
vi.mock('$lib/loaders/base.js', () => ({
  userDeletionLoader: () => () => NEVER,
  addressLoader: () => of()
}));
vi.mock('$lib/helpers/relay-helper.js', async (orig) => ({
  ...(await orig()),
  getAllLookupRelays: () => []
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/services/curated-authors-service.svelte.js', () => ({
  applyCuratedFilter: (f) => f
}));
vi.mock('$lib/stores/calendar-filters.svelte.js', () => ({ calendarFilters: {} }));

const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const { validateAndTransformCalendarEvents } = await import('$lib/helpers/eventUtils');
const { filterUpcomingEvents, mergeCommunityActivity } = await import(
  '$lib/helpers/dashboardFilters.js'
);
const { mergeFeedItems, selectUpcomingEvents } = await import('$lib/helpers/community-feed.js');
const { useCalendarEventLoader } = await import('$lib/loaders/calendar-event-loader.svelte.js');

const ME = 'a'.repeat(64);
const COMMUNITY = 'c'.repeat(64);
const future = Math.floor(Date.now() / 1000) + 86400;

/** @param {string} id @param {string[][]} extra */
function calendarEvent(id, extra) {
  return {
    id: id.padEnd(64, '0'),
    kind: 31923,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    sig: 'f'.repeat(128),
    tags: [['d', id], ['title', id], ['start', String(future)], ...extra]
  };
}
const publicEvent = calendarEvent('public', [['h', COMMUNITY]]);
const meeting = calendarEvent('meeting', [['h', '4c9b50c8c413f15e']]);
const ids = (list) => list.map((e) => (e.originalEvent ?? e).id);

describe('generic calendar pipelines skip channel meetings', () => {
  it('validateAndTransformCalendarEvents (calendar range / global models)', () => {
    expect(ids(validateAndTransformCalendarEvents([publicEvent, meeting]))).toEqual([
      publicEvent.id
    ]);
  });

  it('dashboard upcoming events and community activity', () => {
    expect(ids(filterUpcomingEvents([publicEvent, meeting], future - 10))).toEqual([
      publicEvent.id
    ]);
    const merged = mergeCommunityActivity(new Map([[COMMUNITY, [publicEvent, meeting]]]));
    expect(ids(merged)).toEqual([publicEvent.id]);
  });

  it('feeds (community home, dashboard follows) and their upcoming rail', () => {
    expect(ids(mergeFeedItems([[publicEvent], [meeting]], 10).all)).toEqual([publicEvent.id]);
    expect(ids(selectUpcomingEvents([publicEvent, meeting], () => future, future - 10, 5))).toEqual(
      [publicEvent.id]
    );
  });
});

describe('calendar event loader (personal calendar = my events)', () => {
  beforeEach(() => {
    eventStore.add(publicEvent);
    eventStore.add(meeting);
  });

  it('does not list my own channel meeting', () => {
    const onEventsUpdate = vi.fn();
    const loader = useCalendarEventLoader({
      onEventsUpdate,
      onLoadingChange: () => {},
      onError: () => {}
    });
    loader.loadByAuthor(ME);
    const last = onEventsUpdate.mock.calls.at(-1)[0];
    expect(ids(last)).toEqual([publicEvent.id]);
    loader.cleanup();
  });
});
