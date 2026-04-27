/**
 * CalendarEventCard Component Tests
 *
 * Tests both default card variant and new list variant rendering.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CalendarEventCard from '../calendar/CalendarEventCard.svelte';

// Mock dependencies
// Mock app-settings before any imports that transitively depend on it
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { debugMode: false, gatedMode: false }
}));
vi.mock('$lib/paraglide/messages', () => ({
  event_card_all_day: () => 'All Day',
  event_card_date_event: () => 'Date Event',
  event_card_time_event: () => 'Time Event',
  event_card_created: () => 'Created',
  event_tags_view_all_tooltip: () => '',
  event_tags_more_count: () => '',
  debug_panel_raw_nostr_event: () => '',
  common_copied: () => '',
  common_copy: () => '',
  attendee_indicator_attendees_label: () => '',
  attendee_indicator_accepted_label: () => '',
  attendee_indicator_maybe_label: () => '',
  attendee_indicator_declined_label: () => '',
  attendee_indicator_show_all: () => '',
  attendee_indicator_modal_title: () => '',
  attendee_indicator_modal_close: () => ''
}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: (/** @type {any} */ date, /** @type {any} */ format) => {
    if (format === 'time') return '14:00';
    return 'Jan 15';
  },
  formatRelativeTime: () => '2h ago'
}));
vi.mock('$lib/stores/calendar-event-rsvps.svelte.js', () => ({
  useCalendarEventRsvps: () => ({ rsvps: [], loading: false })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null }
}));
vi.mock('$lib/helpers/rsvpUtils.js', () => ({
  transformRsvps: () => ({ accepted: [], tentative: [], declined: [], totalCount: 0 })
}));
// Mock heavy sub-components to avoid deep dependency chains
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/EventTags.svelte', () => ({ default: () => ({}) }));
vi.mock('../calendar/AttendeeIndicator.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/LocationLink.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/MarkdownRenderer.svelte', () => ({ default: () => ({}) }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: () => ({}) }));

const mockTimeEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 31923,
  title: 'Test Conference Talk',
  start: Math.floor(Date.now() / 1000),
  end: Math.floor(Date.now() / 1000) + 3600,
  image: 'https://example.com/event.jpg',
  summary: 'A talk about testing in JavaScript.',
  locations: [{ name: 'Room 42' }],
  hashtags: ['testing', 'javascript'],
  createdAt: Math.floor(Date.now() / 1000),
  originalEvent: {
    id: 'a'.repeat(64),
    kind: 31923,
    pubkey: 'b'.repeat(64),
    tags: [],
    created_at: Math.floor(Date.now() / 1000)
  }
};

const mockDateEvent = {
  ...mockTimeEvent,
  kind: 31922,
  title: 'All Day Workshop'
};

describe('CalendarEventCard', () => {
  describe('default (card) variant', () => {
    it('renders as card layout by default', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent }
      });

      const card = container.querySelector('.calendar-event-card');
      expect(card).toBeTruthy();
    });

    it('shows event title', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent }
      });

      expect(container.textContent).toContain('Test Conference Talk');
    });
  });

  describe('author header', () => {
    it('renders author name when authorProfile is provided (non-compact)', () => {
      const authorProfile = { name: 'Alice Example' };
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, authorProfile }
      });

      expect(container.textContent).toContain('Alice Example');
    });

    it('does not render author header when authorProfile is null', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, authorProfile: null }
      });

      // Author name shouldn't leak anywhere
      expect(container.textContent).not.toContain('Alice Example');
    });

    it('does not render author header in compact mode even with authorProfile', () => {
      const authorProfile = { name: 'Alice Example' };
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, authorProfile, compact: true }
      });

      expect(container.textContent).not.toContain('Alice Example');
    });
  });

  describe('list variant', () => {
    it('renders with list-variant class', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const listItem = container.querySelector('.calendar-event-card-list');
      expect(listItem).toBeTruthy();
    });

    it('renders as horizontal flex row', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const listItem = /** @type {HTMLElement} */ (
        container.querySelector('.calendar-event-card-list')
      );
      expect(listItem).toBeTruthy();
      expect(listItem.classList.contains('flex')).toBe(true);
    });

    it('shows a small square thumbnail', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const thumbnail = container.querySelector('.calendar-event-card-list .list-thumbnail');
      expect(thumbnail).toBeTruthy();
    });

    it('shows event title', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      expect(container.textContent).toContain('Test Conference Talk');
    });

    it('shows date and time info', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      // Should show formatted date
      expect(container.textContent).toContain('Jan 15');
    });

    it('does not show reaction bar', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const listItem = container.querySelector('.calendar-event-card-list');
      const reactionBar = listItem?.querySelector('[data-testid="reaction-bar"]');
      expect(reactionBar).toBeFalsy();
    });

    it('does not show tags', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const listItem = container.querySelector('.calendar-event-card-list');
      // EventTags should not be present
      const tagElements = listItem?.querySelectorAll('.badge');
      expect(tagElements?.length || 0).toBe(0);
    });

    it('keeps left border accent for all-day events', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockDateEvent, variant: 'list' }
      });

      const listItem = container.querySelector('.calendar-event-card-list');
      expect(listItem?.classList.contains('border-l-4')).toBe(true);
      expect(listItem?.classList.contains('border-l-info')).toBe(true);
    });

    it('is clickable', () => {
      const { container } = render(CalendarEventCard, {
        props: { event: mockTimeEvent, variant: 'list' }
      });

      const listItem = container.querySelector('.calendar-event-card-list');
      expect(listItem?.getAttribute('role')).toBe('button');
      expect(listItem?.getAttribute('tabindex')).toBe('0');
    });
  });
});
