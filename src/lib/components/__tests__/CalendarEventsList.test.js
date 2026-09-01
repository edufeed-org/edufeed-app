/**
 * CalendarEventsList Component Tests
 *
 * Regression guard: cards must navigate to the detail page rather than open
 * the legacy CalendarEventDetailsModal. The list must NOT pass `onEventClick`
 * down to CalendarEventCard — the card's built-in goto() fallback handles
 * navigation when the prop is absent.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
vi.mock('$lib/paraglide/messages', () => ({
  events_list_dismiss: () => 'Dismiss',
  events_list_upcoming_header: () => 'Upcoming',
  events_list_past_header: () => 'Past',
  events_list_jump_to_past: () => 'Jump to past',
  events_list_back_to_top: () => 'Back to top',
  events_list_upcoming_empty: () => 'No upcoming events',
  events_list_past_empty: () => 'No past events',
  events_list_show_more: () => 'Show more',
  aria_jump_past_events: () => '',
  aria_back_to_top: () => ''
}));
vi.mock('$lib/helpers/calendar.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  filterEventsByViewMode: (/** @type {any} */ events) => events
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

// Spy on CalendarEventCard so we can inspect which props the list passes in.
const cardPropsSpy = vi.fn();
vi.mock('$lib/components/calendar/CalendarEventCard.svelte', () => ({
  default: function MockCard(/** @type {any} */ _node, /** @type {any} */ props) {
    cardPropsSpy(props);
    return {};
  }
}));

// Stub heavy icons + sub-components to avoid pulling in deep deps.
vi.mock('$lib/components/icons', () => ({
  CalendarIcon: () => ({}),
  AlertIcon: () => ({}),
  ChevronDownIcon: () => ({})
}));

import CalendarEventsList from '../calendar/CalendarEventsList.svelte';

const futureEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 31923,
  title: 'Upcoming Event',
  start: Math.floor(Date.now() / 1000) + 86400,
  end: Math.floor(Date.now() / 1000) + 90000,
  hashtags: [],
  createdAt: Math.floor(Date.now() / 1000),
  originalEvent: {
    id: 'a'.repeat(64),
    kind: 31923,
    pubkey: 'b'.repeat(64),
    tags: [],
    created_at: Math.floor(Date.now() / 1000)
  }
};

describe('CalendarEventsList', () => {
  it('does NOT pass onEventClick to CalendarEventCard (regression: cards must navigate, not open modal)', () => {
    cardPropsSpy.mockClear();
    render(CalendarEventsList, {
      props: { events: [futureEvent], viewMode: 'month', currentDate: new Date() }
    });

    expect(cardPropsSpy).toHaveBeenCalled();
    for (const [props] of cardPropsSpy.mock.calls) {
      expect(props).not.toHaveProperty('onEventClick');
    }
  });

  it('keeps an ongoing open-ended event (no end tag) in Upcoming until its day ends', () => {
    // Started 2h ago, no end tag: NIP-52 open end = ends the same day, so it
    // is still running and must not be filed under "Past".
    const nowSec = Math.floor(Date.now() / 1000);
    const ongoingEvent = {
      ...futureEvent,
      id: 'c'.repeat(64),
      // 2h ago, clamped to the current UTC day so the test can't straddle midnight
      start: Math.max(nowSec - 2 * 3600, Math.floor(nowSec / 86400) * 86400),
      end: 0
    };
    const { queryByText } = render(CalendarEventsList, {
      props: { events: [ongoingEvent], viewMode: 'month', currentDate: new Date() }
    });

    expect(queryByText('No upcoming events')).toBeNull();
    expect(queryByText('No past events')).not.toBeNull();
  });
});
