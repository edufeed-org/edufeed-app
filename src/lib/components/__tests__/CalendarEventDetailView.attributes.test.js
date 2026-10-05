// @ts-nocheck
/**
 * CalendarEventDetailView — educational attributes (issue #13), online
 * events without a map (issue #8) and translated participant roles.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { NEVER } from 'rxjs';
import * as m from '$lib/paraglide/messages';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';

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
  () => import('./fixtures/EventLocationMapStub.svelte')
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

/** @param {string[][]} extraTags */
function fixture(extraTags) {
  const rawEvent = {
    id: 'e'.repeat(64),
    kind: 31922,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', 'event-1'],
      ['title', 'Fortbildung OER'],
      ['start', '2033-05-18'],
      ['location', 'https://meet.example/oer'],
      ...extraTags
    ]
  };
  return { event: getCalendarEventMetadata(rawEvent), rawEvent };
}

const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';

beforeEach(() => vi.clearAllMocks());

describe('CalendarEventDetailView — educational attributes', () => {
  it('shows registration, free price, mode and educational levels', () => {
    render(CalendarEventDetailView, {
      props: fixture([
        ['registrationRequired', 'true'],
        ['price', '0', 'EUR'],
        ['eventAttendanceMode', 'https://schema.org/MixedEventAttendanceMode'],
        ['educationalLevel:id', LEVEL_C],
        ['educationalLevel:prefLabel:de', 'Fortbildung'],
        ['educationalLevel:type', 'Concept']
      ])
    });
    const summary = screen.getByTestId('event-attributes-summary');
    expect(summary.textContent).toContain(m.event_attrs_registration_required());
    expect(summary.textContent).toContain(m.event_attrs_price_free());
    expect(summary.textContent).toContain(m.event_attrs_mode_mixed_short());
    expect(summary.textContent).toContain('Fortbildung');
  });

  it('shows the amount of a paid event', () => {
    render(CalendarEventDetailView, { props: fixture([['price', '25', 'EUR']]) });
    expect(screen.getByTestId('event-attributes-summary').textContent).toContain(
      m.event_attrs_price_paid_amount({ amount: '25', currency: 'EUR' })
    );
  });

  it('renders no attribute row for a plain NIP-52 event', () => {
    render(CalendarEventDetailView, { props: fixture([]) });
    expect(screen.queryByTestId('event-attributes-summary')).toBeNull();
  });

  it('hides the map for online events (#8) and keeps it otherwise', () => {
    const online = render(CalendarEventDetailView, {
      props: fixture([['eventAttendanceMode', 'https://schema.org/OnlineEventAttendanceMode']])
    });
    expect(screen.queryByTestId('event-location-map-stub')).toBeNull();
    online.unmount();

    render(CalendarEventDetailView, {
      props: fixture([['eventAttendanceMode', 'https://schema.org/MixedEventAttendanceMode']])
    });
    expect(screen.getByTestId('event-location-map-stub')).toBeTruthy();
  });

  it('shows translated participant roles, custom roles as-is', () => {
    render(CalendarEventDetailView, {
      props: fixture([
        ['p', 'b'.repeat(64), '', 'organizer'],
        ['participant', 'Erika', '', 'attendee'],
        ['participant', 'Max', '', 'Kameramann']
      ])
    });
    const badges = Array.from(document.querySelectorAll('.badge-primary')).map(
      (el) => el.textContent
    );
    expect(badges).toContain(m.participant_role_organizer());
    expect(badges).toContain(m.participant_role_attendee());
    expect(badges).toContain('Kameramann');
    expect(badges).not.toContain('organizer');
  });
});
