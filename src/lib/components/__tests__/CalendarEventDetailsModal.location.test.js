// @ts-nocheck
/**
 * The calendar event preview modal rendered its location section from
 * `event.locations`, a field the parsed metadata (getCalendarEventMetadata)
 * never has — it carries a single `location` string — so the preview never
 * showed where an event takes place. It must show the location and, like the
 * detail view, a map except for online events (#8).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

const ME = 'a'.repeat(64);

const h = vi.hoisted(() => ({ modal: null, goto: null }));

vi.mock('$app/navigation', () => ({ goto: (...a) => h.goto(...a) }));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  get modalStore() {
    return h.modal;
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: ME } }
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: () => () => null
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock(
  '$lib/components/calendar/EventDebugInfo.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/EventLocationMap.svelte',
  () => import('./fixtures/EventLocationMapStub.svelte')
);
vi.mock(
  '$lib/components/shared/MarkdownRenderer.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/PersonalCalendarShare.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/CommunityShare.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/reactions/ReactionBar.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/ProfileCard.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/calendar/NamedParticipant.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/EventContextMenu.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock('$lib/components/shared/HeroImage.svelte', () => import('./__mocks__/EmptyStub.svelte'));
vi.mock(
  '$lib/components/shared/ImageLicenseOverlay.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);

const { default: CalendarEventDetailsModal } = await import(
  '$lib/components/calendar/CalendarEventDetailsModal.svelte'
);

function fixture(overrides = {}) {
  return {
    id: 'e'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 31923,
    title: 'Elternabend',
    start: 2_000_000_000,
    end: 2_000_003_600,
    location: 'Aula, Schulstraße 1, Berlin',
    hashtags: [],
    participants: [],
    references: [],
    createdAt: 1_700_000_000,
    dTag: 'event-1',
    originalEvent: null,
    ...overrides
  };
}

function open(event) {
  h.modal = {
    activeModal: 'eventDetails',
    modalProps: { event },
    openModal: vi.fn(),
    closeModal: vi.fn()
  };
  return render(CalendarEventDetailsModal);
}

describe('CalendarEventDetailsModal — location', () => {
  beforeEach(() => {
    // jsdom has no <dialog> modal API.
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    h.goto = vi.fn();
  });

  it('shows the location and a map for an in-person event', () => {
    open(fixture());

    expect(screen.getByRole('heading', { name: m.event_details_location() })).toBeTruthy();
    expect(screen.getByText('Aula, Schulstraße 1, Berlin')).toBeTruthy();
    expect(screen.getByTestId('event-location-map-stub')).toBeTruthy();
  });

  it('shows the location but no map for an online event (#8)', () => {
    open(
      fixture({
        location: 'https://meet.example/room',
        attributes: { attendanceMode: 'online', educationalLevels: [] }
      })
    );

    expect(screen.getByRole('heading', { name: m.event_details_location() })).toBeTruthy();
    expect(screen.queryByTestId('event-location-map-stub')).toBeNull();
  });

  it('renders no location section when the event has none', () => {
    open(fixture({ location: '' }));

    expect(screen.queryByRole('heading', { name: m.event_details_location() })).toBeNull();
    expect(screen.queryByTestId('event-location-map-stub')).toBeNull();
  });
});
