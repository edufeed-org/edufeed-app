// @ts-nocheck
/**
 * A channel meeting reached through a calendar detail route (naddr) shows a
 * notice instead of the public calendar detail: no edit/share menu, no
 * reactions/comments/RSVPs, and no REQ naming its address on public relays.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { NEVER } from 'rxjs';
import * as m from '$lib/paraglide/messages';

const h = vi.hoisted(() => ({ group: null, rsvps: null }));
h.group = vi.fn(() => ({ request: () => NEVER }));
h.rsvps = vi.fn(() => ({ rsvps: [], loading: false }));
const ME = 'a'.repeat(64);

vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: { group: (...a) => h.group(...a) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME }),
  manager: { active: { pubkey: ME } }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appRelays: {}, calendar: { locale: 'de-DE', timeFormat: '24h' } }
}));
vi.mock('$lib/stores/calendar-event-rsvps.svelte.js', () => ({
  useCalendarEventRsvps: (...a) => h.rsvps(...a)
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: { openModal: vi.fn() } }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock(
  '$lib/components/shared/DetailHeader.svelte',
  () => import('./fixtures/DetailHeaderStub.svelte')
);
vi.mock(
  '$lib/components/comments/CommentList.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/reactions/ReactionBar.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/MarkdownRenderer.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/AddToCalendarDropdown.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/calendar/EventTags.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock('$lib/components/shared/LocationLink.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/EventLocationMap.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/ProfileCard.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/NamedParticipant.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/calendar/InlineRsvp.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/AttendeeIndicator.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/HeroImage.svelte', () => import('./__mocks__/EmptyStub.svelte'));

const { default: CalendarEventDetailView } = await import(
  '$lib/components/calendar/CalendarEventDetailView.svelte'
);

/** @param {string} h */
function fixture(hValue) {
  const rawEvent = {
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', 'meeting-1'],
      ['title', 'Elternabend'],
      ['start', '2000000000'],
      ['h', hValue]
    ]
  };
  const event = {
    id: rawEvent.id,
    kind: 31923,
    pubkey: ME,
    title: 'Elternabend',
    start: 2000000000,
    dTag: 'meeting-1',
    participants: [],
    hashtags: [],
    references: [],
    originalEvent: rawEvent
  };
  return { event, rawEvent };
}

beforeEach(() => vi.clearAllMocks());

describe('CalendarEventDetailView — channel meeting', () => {
  it('shows the channel notice and nothing that publishes or queries publicly', () => {
    render(CalendarEventDetailView, { props: fixture('4c9b50c8c413f15e') });
    expect(screen.getByTestId('channel-meeting-notice').textContent).toContain(
      m.meeting_detail_channel_only()
    );
    expect(screen.queryByTestId('detail-header-stub')).toBeNull();
    expect(h.rsvps).not.toHaveBeenCalled();
    expect(h.group).not.toHaveBeenCalled();
  });

  it('renders the normal detail for a community calendar event', () => {
    render(CalendarEventDetailView, { props: fixture('c'.repeat(64)) });
    expect(screen.queryByTestId('channel-meeting-notice')).toBeNull();
    expect(screen.getByTestId('detail-header-stub').dataset.canEdit).toBe('true');
    expect(h.rsvps).toHaveBeenCalled();
  });
});
