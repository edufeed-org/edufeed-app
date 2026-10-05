// @ts-nocheck
/**
 * GitHub #12: "Edit" in the calendar event preview modal did nothing visible.
 * It navigated to the detail page while leaving the preview modal open on top,
 * so the user had to close it and click Edit again on the detail page.
 *
 * Edit must open the edit form directly — the same `calendarEvent` modal in
 * edit mode the detail view opens — replacing the preview modal.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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
vi.mock('$lib/components/shared/LocationLink.svelte', () => import('./__mocks__/EmptyStub.svelte'));
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

function fixture() {
  const originalEvent = {
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: ME,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['d', 'event-1'],
      ['title', 'Elternabend'],
      ['start', '2000000000']
    ],
    sig: 'f'.repeat(128)
  };
  return {
    id: originalEvent.id,
    pubkey: ME,
    kind: 31923,
    title: 'Elternabend',
    start: 2_000_000_000,
    end: 2_000_003_600,
    hashtags: [],
    participants: [],
    references: [],
    createdAt: originalEvent.created_at,
    dTag: 'event-1',
    originalEvent
  };
}

describe('CalendarEventDetailsModal — Edit (GitHub #12)', () => {
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

  it('opens the edit form directly instead of navigating away under the open preview', async () => {
    const event = fixture();
    h.modal = {
      activeModal: 'eventDetails',
      modalProps: { event },
      openModal: vi.fn(),
      closeModal: vi.fn()
    };

    render(CalendarEventDetailsModal);

    await fireEvent.click(screen.getByText(m.event_management_edit()));

    expect(h.modal.openModal).toHaveBeenCalledWith('calendarEvent', {
      mode: 'edit',
      existingEvent: event,
      existingRawEvent: event.originalEvent,
      communityPubkey: event.pubkey
    });
    expect(h.goto).not.toHaveBeenCalled();
  });
});
