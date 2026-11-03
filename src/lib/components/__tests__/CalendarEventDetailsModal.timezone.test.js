// @ts-nocheck
/**
 * NIP-52 start_tzid/end_tzid in the event preview modal: times are shown in
 * the event's zone next to its label, plus the viewer's own time when that
 * differs (see CalendarEventDetailView.timezone.test.js).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

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

function open(event) {
  h.modal = {
    activeModal: 'eventDetails',
    modalProps: { event },
    openModal: vi.fn(),
    closeModal: vi.fn()
  };
  return render(CalendarEventDetailsModal);
}

const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;

// 2026-05-04 10:00 New York = 16:00 Berlin; ends 11:30 New York = 17:30 Berlin
const START = Date.UTC(2026, 4, 4, 14, 0) / 1000;
const END = Date.UTC(2026, 4, 4, 15, 30) / 1000;

function fixture(overrides = {}) {
  return {
    id: 'e'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 31923,
    title: 'Webinar',
    start: START,
    end: END,
    location: '',
    hashtags: [],
    participants: [],
    references: [],
    createdAt: 1_700_000_000,
    dTag: 'event-1',
    originalEvent: null,
    ...overrides
  };
}

describe('CalendarEventDetailsModal — event time zone', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function () {
      this.open = false;
    };
    h.goto = vi.fn();
    // The worker's zone cannot be switched at runtime; pin the viewer's zone
    // the way getCurrentTimezone() reads it.
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function () {
      return { ...realResolved.call(this), timeZone: 'Europe/Berlin' };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the event-zone time with its label and the viewer's time beside it", () => {
    open(fixture({ startTimezone: 'America/New_York', endTimezone: 'America/New_York' }));
    const start = screen.getByTestId('event-start-time').textContent;
    expect(start).toContain('10:00');
    expect(start).toContain('America/New_York');
    expect(start).toContain('(16:00 Europe/Berlin)');
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('(17:30 Europe/Berlin)');
  });

  it("labels the end with start_tzid's zone when end_tzid is missing", () => {
    open(fixture({ startTimezone: 'America/New_York' }));
    const end = screen.getByTestId('event-end-time').textContent;
    expect(end).toContain('11:30');
    expect(end).toContain('America/New_York');
  });
});
