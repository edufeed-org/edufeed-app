// @ts-nocheck
/**
 * The first reference link of a calendar event is its main page ("event
 * website", GitHub #7): shown prominently in the date/time block, the
 * remaining links stay under "Further links".
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

function fixture(references) {
  const rawEvent = {
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', 'barcamp'],
      ['title', 'Barcamp'],
      ['start', '2000000000'],
      ...references.map((r) => ['r', r])
    ]
  };
  const event = {
    id: rawEvent.id,
    kind: 31923,
    pubkey: ME,
    title: 'Barcamp',
    start: 2000000000,
    dTag: 'barcamp',
    participants: [],
    hashtags: [],
    references,
    originalEvent: rawEvent
  };
  return { event, rawEvent };
}

beforeEach(() => vi.clearAllMocks());

describe('CalendarEventDetailView — event website link (#7)', () => {
  it('shows the first http(s) reference prominently, the rest under further links', () => {
    render(CalendarEventDetailView, {
      props: fixture(['https://www.barcamp.example/2026', 'https://docs.example.org/slides'])
    });
    const link = screen.getByTestId('event-website-link');
    expect(link.getAttribute('href')).toBe('https://www.barcamp.example/2026');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent).toContain(m.calendar_event_website());
    expect(link.textContent).toContain('barcamp.example');

    const further = screen.getByTestId('event-further-links');
    expect(further.textContent).toContain(m.calendar_detail_links());
    expect(further.textContent).toContain('https://docs.example.org/slides');
    expect(further.textContent).not.toContain('https://www.barcamp.example/2026');
  });

  it('hides the further-links card when the website is the only link', () => {
    render(CalendarEventDetailView, { props: fixture(['https://barcamp.example']) });
    expect(screen.getByTestId('event-website-link')).toBeTruthy();
    expect(screen.queryByTestId('event-further-links')).toBeNull();
  });

  it('falls back to the plain links list when the first link is not http(s)', () => {
    render(CalendarEventDetailView, {
      props: fixture(['mailto:info@barcamp.example', 'https://barcamp.example'])
    });
    expect(screen.queryByTestId('event-website-link')).toBeNull();
    const further = screen.getByTestId('event-further-links');
    expect(further.textContent).toContain('mailto:info@barcamp.example');
    expect(further.textContent).toContain('https://barcamp.example');
  });

  it('renders neither without references', () => {
    render(CalendarEventDetailView, { props: fixture([]) });
    expect(screen.queryByTestId('event-website-link')).toBeNull();
    expect(screen.queryByTestId('event-further-links')).toBeNull();
  });
});
