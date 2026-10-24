// @ts-nocheck
/**
 * The standalone event page (`/calendar/event/<naddr>`) must show the same
 * image license pill as the card and the details modal: the hash from the
 * Blossom image URL feeds `useLicenseStatus`, and the resulting status/event
 * are handed to `ImageLicenseOverlay` inside the HeroImage.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { NEVER } from 'rxjs';

const HASH = '695bed00'.repeat(8); // 64 hex chars
const LICENSE_EVENT = {
  id: 'f'.repeat(64),
  kind: 1063,
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  content: '',
  tags: [
    ['x', HASH],
    ['license', 'https://creativecommons.org/licenses/by/4.0/'],
    ['credit', 'Nadine Glage']
  ]
};

const h = vi.hoisted(() => ({ group: null, rsvps: null, hashes: [] }));
h.group = vi.fn(() => ({ request: () => NEVER }));
h.rsvps = vi.fn(() => ({ rsvps: [], loading: false }));
const ME = 'a'.repeat(64);

vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  // featured calendars: fetchEvents (pool.request) + eventStore.model
  eventStore: { add: vi.fn(), model: () => NEVER },
  pool: { group: (...a) => h.group(...a), request: () => NEVER }
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
// The license hook resolves synchronously from the hash it is asked for, so
// the test can assert both the hash extraction and the prop wiring.
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: (getHash) => () => {
    const hash = getHash();
    h.hashes.push(hash);
    return hash === HASH
      ? { event: LICENSE_EVENT, status: 'found' }
      : { event: null, status: 'missing' };
  }
}));
vi.mock(
  '$lib/components/shared/ImageLicenseOverlay.svelte',
  () => import('./fixtures/ImageLicenseOverlayStub.svelte')
);
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

const { default: CalendarEventDetailView } = await import(
  '$lib/components/calendar/CalendarEventDetailView.svelte'
);

function fixture(image) {
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
      ...(image ? [['image', image]] : [])
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
    references: [],
    image,
    originalEvent: rawEvent
  };
  return { event, rawEvent };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hashes.length = 0;
});

describe('CalendarEventDetailView — image license pill', () => {
  it('looks up the license by the Blossom hash and renders the pill with the found attestation', () => {
    render(CalendarEventDetailView, {
      props: fixture(`https://blossom.edufeed.org/${HASH}.png`)
    });
    expect(h.hashes).toContain(HASH);
    const pill = screen.getByTestId('image-license-overlay-stub');
    expect(pill.dataset.status).toBe('found');
    expect(pill.dataset.variant).toBe('pill');
    expect(pill.dataset.licenseId).toBe(LICENSE_EVENT.id);
  });

  it('asks for no hash and shows the missing-license pill for a non-Blossom image URL', () => {
    render(CalendarEventDetailView, {
      props: fixture('https://example.org/poster.jpg')
    });
    expect(h.hashes.every((x) => x === null)).toBe(true);
    expect(screen.getByTestId('image-license-overlay-stub').dataset.status).toBe('missing');
  });

  it('renders no overlay when the event has no image', () => {
    render(CalendarEventDetailView, { props: fixture(undefined) });
    expect(screen.queryByTestId('image-license-overlay-stub')).toBeNull();
  });
});
