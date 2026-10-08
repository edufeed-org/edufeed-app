// @ts-nocheck
/**
 * CalendarEventModal: the normal calendar-event path (regression) and the
 * "Termin planen" group-meeting mode (M2 of scheduled meetings).
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { of } from 'rxjs';
import * as m from '$lib/paraglide/messages';

const ME = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const GUEST_URL = 'https://app.example/call/x#' + 'C'.repeat(22);

const h = vi.hoisted(() => {
  const user = new (class Account {
    pubkey = 'a'.repeat(64);
    signer = {
      signEvent: async (e) => e,
      nip44: { encrypt: async (_pk, t) => t, decrypt: async (_pk, c) => c }
    };
  })();
  return {
    user,
    modalStore: {
      activeModal: 'calendarEvent',
      modalProps: {},
      closeModal: () => {},
      openModal: () => {}
    },
    createEvent: null,
    updateEvent: null,
    scheduleGroupMeeting: null,
    sendMeetingInvites: null,
    showToast: null,
    goto: null,
    poolRelay: null
  };
});
h.createEvent = vi.fn();
h.updateEvent = vi.fn();
h.scheduleGroupMeeting = vi.fn();
h.sendMeetingInvites = vi.fn();
h.showToast = vi.fn();
h.goto = vi.fn(async () => {});
h.poolRelay = vi.fn((url) => ({ url }));
h.modalStore.closeModal = vi.fn();

vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: h.modalStore }));
vi.mock('$lib/stores/calendar-actions.svelte.js', () => ({
  useCalendarActions: () => ({
    createEvent: (...a) => h.createEvent(...a),
    updateEvent: (...a) => h.updateEvent(...a)
  })
}));
vi.mock('$lib/stores/calendar-management-store.svelte.js', () => ({
  useCalendarManagement: () => ({ calendars: [], addEventToCalendar: vi.fn() })
}));
vi.mock('$lib/helpers/shareable-communities.svelte.js', () => ({
  useShareableCommunities: () => () => []
}));
vi.mock('$lib/stores/share-restrictions.svelte.js', () => ({
  useShareRestrictions: () => () => new Set()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: h.user, active$: of(h.user) }
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (...a) => h.poolRelay(...a) }
}));
vi.mock('$lib/groups/schedule-meeting.js', () => ({
  scheduleGroupMeeting: (...a) => h.scheduleGroupMeeting(...a),
  sendMeetingInvites: (...a) => h.sendMeetingInvites(...a)
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: (...a) => h.showToast(...a) }));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getCalendarRelays: () => [] }));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ encodeEventToNaddr: () => 'naddr1test' }));
vi.mock('$app/navigation', () => ({
  goto: (...a) => h.goto(...a),
  invalidateAll: vi.fn(async () => {})
}));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock(
  '$lib/components/calendar/ParticipantsEditor.svelte',
  () => import('./fixtures/ParticipantsEditorStub.svelte')
);
vi.mock(
  '$lib/components/shared/LocationInput.svelte',
  () => import('./fixtures/LocationInputStub.svelte')
);
vi.mock(
  '$lib/components/shared/EuropeanDateInput.svelte',
  () => import('./fixtures/ValueInputStub.svelte')
);
vi.mock(
  '$lib/components/shared/EuropeanTimeInput.svelte',
  () => import('./fixtures/ValueInputStub.svelte')
);
vi.mock(
  '$lib/components/shared/LicensedImageInput.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/shared/EditableList.svelte',
  () => import('./fixtures/EditableListStub.svelte')
);
vi.mock(
  '$lib/components/calendar/CalendarSelector.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/calendar/CommunitySelector.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);
vi.mock(
  '$lib/components/forms/FormConceptPicker.svelte',
  () => import('./fixtures/FormConceptPickerStub.svelte')
);
vi.mock('$lib/helpers/educational/vocabResolver.js', () => ({
  resolveVocabField: () => ({
    type: 'concept-picker',
    id: 'educationalLevel',
    label: 'educationalLevel',
    vocab: { address: '39737:pub:educational-level', relay: '' }
  })
}));

import CalendarEventModal from '../calendar/CalendarEventModal.svelte';

const GROUP_MEETING = {
  pointer: { id: 'g1', relay: 'wss://groups.example/' },
  channelName: 'Arbeitszimmer',
  channelUrl: 'https://app.example/c/npub1x/g/g1',
  memberPubkeys: [ME, MEMBER],
  passesSupported: true
};

const settle = () => new Promise((r) => setTimeout(r, 0));

/** @param {HTMLElement} container @param {string} selector @param {string} value */
async function setInput(container, selector, value) {
  const input = container.querySelector(selector);
  input.value = value;
  await fireEvent.input(input);
}

/** @param {Date} d */
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function isoDaysFromNow(days) {
  return localIso(new Date(Date.now() + days * 86400_000));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.modalStore.activeModal = 'calendarEvent';
  h.createEvent.mockImplementation(async () => ({ id: 'ev1', kind: 31922, tags: [] }));
  h.scheduleGroupMeeting.mockImplementation(async () => ({
    event: { id: 'meeting-id' },
    start: 1_800_000_000,
    end: 1_800_003_600,
    guestUrl: GUEST_URL,
    guestStatus: 'created'
  }));
  h.sendMeetingInvites.mockImplementation(async () => ({ sent: 2, failed: [] }));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true
  });
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

describe('CalendarEventModal — normal calendar event (regression)', () => {
  beforeEach(() => {
    h.modalStore.modalProps = { communityPubkey: 'comm', mode: 'create' };
  });

  it('shows the type selector, location and the usual title', () => {
    const r = render(CalendarEventModal);
    expect(r.getByText(m.event_modal_title_create())).toBeTruthy();
    expect(r.getByText(m.event_modal_type_all_day())).toBeTruthy();
    expect(r.getByTestId('location-input')).toBeTruthy();
    expect(r.queryByText(m.meeting_modal_guests_label())).toBeNull();
    expect(r.getByTestId('participants-label').textContent).toBe('');
    expect(r.getByText(m.event_modal_event_title())).toBeTruthy();
    expect(r.getAllByTestId('editable-list').length).toBeGreaterThan(0);
  });

  // GitHub #6: users could not add hashtags (NIP-52 t tags) to events.
  it('offers a hashtag list and submits the added hashtags', async () => {
    const r = render(CalendarEventModal);
    await tick();
    expect(r.getByText(m.event_modal_hashtags_label())).toBeTruthy();
    await setInput(r.container, '#title', 'Sommerfest');
    await fireEvent.click(r.getByTestId('stub-add-hashtag'));
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.createEvent).toHaveBeenCalledTimes(1);
    expect(h.createEvent.mock.calls[0][0].hashtags).toEqual(['neu']);
  });

  it('pre-fills the hashtags of the edited event and keeps them on save', async () => {
    const start = Math.floor(new Date('2026-11-02T00:00:00Z').getTime() / 1000);
    const existingRawEvent = {
      id: 'e'.repeat(64),
      kind: 31922,
      pubkey: ME,
      tags: [
        ['d', 'x'],
        ['t', 'OER'],
        ['t', 'nostr'],
        ['t', 'oer']
      ]
    };
    h.modalStore.modalProps = {
      communityPubkey: 'comm',
      mode: 'edit',
      existingRawEvent,
      existingEvent: {
        kind: 31922,
        title: 'Fortbildung',
        start,
        hashtags: ['OER', 'nostr', 'oer'],
        references: [],
        participants: []
      }
    };
    h.updateEvent.mockImplementation(async () => ({ id: 'ev1', kind: 31922, tags: [] }));
    const r = render(CalendarEventModal);
    await tick();
    const list = r.getAllByTestId('editable-list').find((el) => el.dataset.itemType === 'hashtag');
    expect(JSON.parse(list.dataset.items)).toEqual(['oer', 'nostr']);
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.updateEvent).toHaveBeenCalledTimes(1);
    expect(h.updateEvent.mock.calls[0][0].hashtags).toEqual(['oer', 'nostr']);
  });

  // The default day is the LOCAL date: east of UTC just after midnight,
  // toISOString() still names yesterday (M2 review).
  // (The worker's zone cannot be switched at runtime, so the instant is
  // 22:30 UTC — already the next day anywhere east of UTC, e.g. CEST.)
  it('defaults the start date to the local day, not the UTC day', async () => {
    const day = new Date('2026-10-02T22:30:00Z');
    h.modalStore.modalProps = { ...h.modalStore.modalProps, selectedDate: day };
    const r = render(CalendarEventModal);
    await tick();
    expect(r.container.querySelector('#startDate').value).toBe(localIso(day));
  });

  // GitHub #9: a new event ends the day it starts (all-day ends are stored
  // inclusively, so this is a one-day event there too).
  it('defaults the end date to the start date', async () => {
    const day = new Date('2026-10-05T10:00:00Z');
    h.modalStore.modalProps = { ...h.modalStore.modalProps, selectedDate: day };
    const r = render(CalendarEventModal);
    await tick();
    expect(r.container.querySelector('#endDate').value).toBe(localIso(day));
  });

  it('moves an untouched end date along with the start date', async () => {
    h.modalStore.modalProps = {
      ...h.modalStore.modalProps,
      selectedDate: new Date('2026-10-05T10:00:00Z')
    };
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#startDate', '2026-10-09');
    await tick();
    expect(r.container.querySelector('#endDate').value).toBe('2026-10-09');
  });

  it('keeps a user-chosen end date, but never lets it fall before the start', async () => {
    h.modalStore.modalProps = {
      ...h.modalStore.modalProps,
      selectedDate: new Date('2026-10-05T10:00:00Z')
    };
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#endDate', '2026-10-12');
    await setInput(r.container, '#startDate', '2026-10-07');
    await tick();
    expect(r.container.querySelector('#endDate').value).toBe('2026-10-12');
    await setInput(r.container, '#startDate', '2026-10-15');
    await tick();
    expect(r.container.querySelector('#endDate').value).toBe('2026-10-15');
  });

  it('creates through calendar actions (outbox) and never through the group relay', async () => {
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Sommerfest');
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.createEvent).toHaveBeenCalledTimes(1);
    expect(h.createEvent.mock.calls[0][0].title).toBe('Sommerfest');
    expect(h.createEvent.mock.calls[0][1]).toEqual(['comm']);
    expect(h.goto).toHaveBeenCalledWith('/calendar/event/naddr1test');
    expect(h.scheduleGroupMeeting).not.toHaveBeenCalled();
    expect(h.sendMeetingInvites).not.toHaveBeenCalled();
  });
});

describe('CalendarEventModal — educational attributes (#13, #8)', () => {
  const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';

  /** @param {HTMLElement} container @param {string} id @param {string} value */
  async function choose(container, id, value) {
    const select = container.querySelector(`#${id}`);
    select.value = value;
    await fireEvent.change(select);
    await tick();
  }

  it('creates with the chosen attributes; online relabels the location', async () => {
    h.modalStore.modalProps = { communityPubkey: 'comm', mode: 'create' };
    const r = render(CalendarEventModal);
    await tick();
    expect(r.getByTestId('location-label').textContent).toBe(m.event_modal_location_label());

    await setInput(r.container, '#title', 'OER-Werkstatt');
    await choose(r.container, 'event-attr-registration', 'true');
    await choose(r.container, 'event-attr-price', 'free');
    await choose(r.container, 'event-attr-mode', 'online');
    await fireEvent.click(r.getByTestId('concept-picker-pick'));
    await tick();
    expect(r.getByTestId('location-label').textContent).toBe(m.event_modal_location_label_online());

    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.createEvent).toHaveBeenCalledTimes(1);
    expect(h.createEvent.mock.calls[0][0].attributes).toEqual({
      educationalLevels: [{ id: LEVEL_C, labels: { de: 'Fortbildung', en: 'Advanced training' } }],
      registrationRequired: true,
      price: { amount: '0', currency: 'EUR' },
      attendanceMode: 'online'
    });
  });

  it('pre-fills the attributes in edit mode and saves them unchanged', async () => {
    const attributes = {
      registrationRequired: false,
      price: { amount: '25', currency: 'EUR' },
      attendanceMode: 'mixed',
      educationalLevels: [{ id: LEVEL_C, labels: { de: 'Fortbildung' } }]
    };
    const rawEvent = { id: 'ev1', kind: 31922, pubkey: ME, tags: [['d', 'x']] };
    h.modalStore.modalProps = {
      mode: 'edit',
      existingEvent: {
        id: 'ev1',
        kind: 31922,
        pubkey: ME,
        title: 'Alt',
        start: 2_000_000_000,
        participants: [],
        references: [],
        attributes
      },
      existingRawEvent: rawEvent
    };
    h.updateEvent.mockImplementation(async () => ({ id: 'ev2' }));
    const r = render(CalendarEventModal);
    await tick();
    expect(r.container.querySelector('#event-attr-registration').value).toBe('false');
    expect(r.container.querySelector('#event-attr-price').value).toBe('paid');
    expect(r.container.querySelector('#event-attr-amount').value).toBe('25');
    expect(r.container.querySelector('#event-attr-mode').value).toBe('mixed');

    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.updateEvent).toHaveBeenCalledTimes(1);
    expect(h.updateEvent.mock.calls[0][0].attributes).toEqual(attributes);
  });

  it('offers no attribute fields for a channel meeting', () => {
    h.modalStore.modalProps = { mode: 'create', groupMeeting: GROUP_MEETING };
    const r = render(CalendarEventModal);
    expect(r.queryByTestId('event-attributes-fields')).toBeNull();
  });
});

describe('CalendarEventModal — group meeting mode', () => {
  beforeEach(() => {
    h.modalStore.modalProps = { mode: 'create', groupMeeting: GROUP_MEETING };
  });

  it('titles the dialog with the channel, hides type/location, labels participants "Einladen"', () => {
    const r = render(CalendarEventModal);
    expect(r.getByText(m.meeting_modal_title({ channel: 'Arbeitszimmer' }))).toBeTruthy();
    expect(r.queryByText(m.event_modal_type_all_day())).toBeNull();
    expect(r.queryByTestId('location-input')).toBeNull();
    expect(r.getByTestId('participants-label').textContent).toBe(m.meeting_modal_invite_label());
    // Timed: the time inputs are there.
    expect(r.container.querySelector('#startTime')).toBeTruthy();
    const toggle = r.getByLabelText(m.meeting_modal_guests_label());
    expect(toggle.checked).toBe(false);
    expect(r.getByText(m.meeting_modal_submit())).toBeTruthy();
  });

  it('defaults the meeting to the local day', async () => {
    const day = new Date('2026-10-02T22:30:00Z');
    h.modalStore.modalProps = { ...h.modalStore.modalProps, selectedDate: day };
    const r = render(CalendarEventModal);
    await tick();
    expect(r.container.querySelector('#startDate').value).toBe(localIso(day));
    expect(r.container.querySelector('#endDate').value).toBe(localIso(day));
  });

  // Final review 3: no guest-link toggle on a relay without call passes.
  it('hides the guest toggle when the channel relay has no call passes', () => {
    h.modalStore.modalProps = {
      mode: 'create',
      groupMeeting: { ...GROUP_MEETING, passesSupported: false }
    };
    const r = render(CalendarEventModal);
    expect(r.queryByLabelText(m.meeting_modal_guests_label())).toBeNull();
  });

  // Issue d0ab04d0 (General channel): calls are off, but the organiser is an
  // admin who may switch them on — the toggle stays, its help says what it does.
  it('offers the guest toggle to an admin who can switch calls on, and says so', () => {
    h.modalStore.modalProps = {
      mode: 'create',
      groupMeeting: {
        ...GROUP_MEETING,
        passesSupported: false,
        callsEnabled: false,
        canEnableCalls: true
      }
    };
    const r = render(CalendarEventModal);
    expect(r.getByLabelText(m.meeting_modal_guests_label())).toBeTruthy();
    expect(r.getByText(m.meeting_modal_guests_help_enables_calls())).toBeTruthy();
    expect(r.queryByText(m.meeting_modal_guests_help())).toBeNull();
  });

  it('tells a member why guest links are unavailable while the channel has no calls', () => {
    h.modalStore.modalProps = {
      mode: 'create',
      groupMeeting: {
        ...GROUP_MEETING,
        passesSupported: false,
        callsEnabled: false,
        canEnableCalls: false
      }
    };
    const r = render(CalendarEventModal);
    expect(r.queryByLabelText(m.meeting_modal_guests_label())).toBeNull();
    expect(r.getByText(m.meeting_modal_guests_calls_off())).toBeTruthy();
  });

  // QA round 3 C5/K1: the generic calendar wording ("Veranstaltungstitel",
  // reference links — whose nowrap label also scrolled the dialog sideways).
  it('uses meeting wording and drops the reference links', () => {
    const r = render(CalendarEventModal);
    expect(r.getByText(m.meeting_modal_title_label())).toBeTruthy();
    expect(r.queryByText(m.event_modal_event_title())).toBeNull();
    expect(r.container.querySelector('#title').placeholder).toBe(
      m.meeting_modal_title_placeholder()
    );
    expect(r.container.querySelector('#summary').placeholder).toBe(
      m.meeting_modal_description_placeholder()
    );
    expect(r.queryByTestId('editable-list')).toBeNull();
    expect(r.getByTestId('participants-help').textContent).toBe(m.meeting_modal_invite_help());
  });

  // QA round 3 C1: opened at 14:58 it pre-filled 09:00–10:00, already past.
  it('pre-fills the next full half hour, one hour long', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 14, 58));
    try {
      const r = render(CalendarEventModal);
      await tick();
      expect(r.container.querySelector('#startDate').value).toBe('2026-10-02');
      expect(r.container.querySelector('#startTime').value).toBe('15:00');
      expect(r.container.querySelector('#endTime').value).toBe('16:00');
    } finally {
      vi.useRealTimers();
    }
  });

  // A guest link is the organiser's self-encrypted pass code: without NIP-44
  // it cannot be made, so the toggle says why instead of failing on submit.
  it('disables the guest toggle with a hint when the signer lacks NIP-44', async () => {
    const nip44 = h.user.signer.nip44;
    delete h.user.signer.nip44;
    try {
      const r = render(CalendarEventModal);
      await tick();
      const toggle = r.getByLabelText(m.meeting_modal_guests_label());
      expect(toggle.disabled).toBe(true);
      expect(r.getByText(m.meeting_modal_guests_no_nip44())).toBeTruthy();
      await setInput(r.container, '#title', 'Elternabend');
      await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
      await settle();
      expect(h.scheduleGroupMeeting.mock.calls[0][0].allowGuests).toBe(false);
    } finally {
      h.user.signer.nip44 = nip44;
    }
  });

  it('schedules on the group relay, copies the guest link and sends invites', async () => {
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Elternabend');
    await fireEvent.click(r.getByTestId('stub-add-participants'));
    await fireEvent.click(r.getByLabelText(m.meeting_modal_guests_label()));
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();

    expect(h.createEvent).not.toHaveBeenCalled();
    expect(h.poolRelay).toHaveBeenCalledWith('wss://groups.example/');
    expect(h.scheduleGroupMeeting).toHaveBeenCalledTimes(1);
    const args = h.scheduleGroupMeeting.mock.calls[0][0];
    expect(args.relayConn).toEqual({ url: 'wss://groups.example/' });
    expect(args.groupMeeting).toEqual(GROUP_MEETING);
    expect(args.user).toBe(h.user);
    expect(args.allowGuests).toBe(true);
    expect(args.origin).toBe(window.location.origin);
    expect(args.formData.title).toBe('Elternabend');
    expect(args.formData.eventType).toBe('time');

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GUEST_URL);
    expect(h.showToast).toHaveBeenCalledWith(m.meeting_scheduled_link_copied_toast(), 'success');
    expect(h.modalStore.closeModal).toHaveBeenCalled();
    expect(h.goto).not.toHaveBeenCalled();

    expect(h.sendMeetingInvites).toHaveBeenCalledWith({
      participants: [{ pubkey: MEMBER }, { pubkey: 'c'.repeat(64) }, { name: 'Erna' }],
      self: ME,
      memberPubkeys: [ME, MEMBER],
      guestUrl: GUEST_URL,
      title: 'Elternabend',
      start: 1_800_000_000,
      channelName: 'Arbeitszimmer',
      channelUrl: GROUP_MEETING.channelUrl
    });
  });

  it('toasts plain "Termin geplant" without guests and copies nothing', async () => {
    h.scheduleGroupMeeting.mockImplementation(async () => ({
      event: { id: 'meeting-id' },
      start: 1_800_000_000,
      end: 1_800_003_600,
      guestUrl: null,
      guestStatus: 'off'
    }));
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Elternabend');
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.scheduleGroupMeeting.mock.calls[0][0].allowGuests).toBe(false);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(h.showToast).toHaveBeenCalledWith(m.meeting_scheduled_toast(), 'success');
  });

  it('warns up front when guests are on but the meeting is beyond the 60-day pass limit', async () => {
    const r = render(CalendarEventModal);
    await tick();
    await fireEvent.click(r.getByLabelText(m.meeting_modal_guests_label()));
    expect(r.queryByText(m.meeting_modal_guests_too_far())).toBeNull();
    const far = isoDaysFromNow(61);
    await setInput(r.container, '#startDate', far);
    await setInput(r.container, '#endDate', far);
    expect(r.getByText(m.meeting_modal_guests_too_far())).toBeTruthy();
  });

  it('tells the organiser the meeting was created without a guest link when too far', async () => {
    h.scheduleGroupMeeting.mockImplementation(async () => ({
      event: { id: 'meeting-id' },
      start: 1_800_000_000,
      end: 1_800_003_600,
      guestUrl: null,
      guestStatus: 'too_far'
    }));
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Elternabend');
    await fireEvent.click(r.getByLabelText(m.meeting_modal_guests_label()));
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.showToast).toHaveBeenCalledWith(m.meeting_scheduled_too_far_toast(), 'info');
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('summarises failed invitations in one toast', async () => {
    h.sendMeetingInvites.mockImplementation(async () => ({
      sent: 1,
      failed: ['c'.repeat(64)]
    }));
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Elternabend');
    await fireEvent.click(r.getByTestId('stub-add-participants'));
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.showToast).toHaveBeenCalledWith(
      m.meeting_invites_failed_toast({ count: 1 }),
      'warning'
    );
  });

  it('keeps the dialog open with an error when the relay rejects the meeting', async () => {
    h.scheduleGroupMeeting.mockRejectedValue(new Error('blocked: not a member'));
    const r = render(CalendarEventModal);
    await tick();
    await setInput(r.container, '#title', 'Elternabend');
    await fireEvent.submit(r.container.querySelector('form:not(.modal-backdrop)'));
    await settle();
    expect(h.modalStore.closeModal).not.toHaveBeenCalled();
    expect(r.getByText(/blocked: not a member/)).toBeTruthy();
    expect(h.sendMeetingInvites).not.toHaveBeenCalled();
  });
});

// Moving the start time drags the end time along (14:30–15:30 moved to 16:00
// must not leave an end at 15:30), rolling the end date past midnight.
describe('CalendarEventModal — end time follows the start time', () => {
  beforeEach(() => {
    h.modalStore.modalProps = { mode: 'create', groupMeeting: GROUP_MEETING };
    vi.useFakeTimers({ toFake: ['Date'] });
    // Pre-fills 15:00–16:00 on 2026-10-02.
    vi.setSystemTime(new Date(2026, 9, 2, 14, 58));
  });

  const value = (r, sel) => r.container.querySelector(sel).value;

  it('keeps the duration while the end time is untouched', async () => {
    try {
      const r = render(CalendarEventModal);
      await tick();
      await setInput(r.container, '#startTime', '16:30');
      await tick();
      expect(value(r, '#endTime')).toBe('17:30');
      expect(value(r, '#endDate')).toBe('2026-10-02');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls the end date past midnight', async () => {
    try {
      const r = render(CalendarEventModal);
      await tick();
      await setInput(r.container, '#startTime', '23:30');
      await tick();
      expect(value(r, '#endTime')).toBe('00:30');
      expect(value(r, '#endDate')).toBe('2026-10-03');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a user-chosen end time until the start reaches it', async () => {
    try {
      const r = render(CalendarEventModal);
      await tick();
      await setInput(r.container, '#endTime', '18:00');
      await setInput(r.container, '#startTime', '17:00');
      await tick();
      expect(value(r, '#endTime')).toBe('18:00');
      // Pushed by the duration the user gave it (15:00–18:00).
      await setInput(r.container, '#startTime', '18:30');
      await tick();
      expect(value(r, '#endTime')).toBe('21:30');
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats an edited event's stored end as chosen", async () => {
    vi.useRealTimers();
    const start = Math.floor(new Date(2026, 9, 7, 14, 30).getTime() / 1000);
    h.modalStore.modalProps = {
      mode: 'edit',
      existingEvent: {
        id: 'ev1',
        kind: 31923,
        pubkey: ME,
        title: 'Treffen',
        start,
        end: start + 3600,
        participants: [],
        references: []
      },
      existingRawEvent: { id: 'ev1', kind: 31923, pubkey: ME, tags: [['d', 'x']] }
    };
    const r = render(CalendarEventModal);
    await tick();
    expect(value(r, '#endTime')).toBe('15:30');
    await setInput(r.container, '#startTime', '15:00');
    await tick();
    expect(value(r, '#endTime')).toBe('15:30');
    // Pushed by the duration the user gave it (14:30–15:30).
    await setInput(r.container, '#startTime', '16:00');
    await tick();
    expect(value(r, '#endTime')).toBe('17:00');
  });

  it('measures the push from a settled start, not from values passed while typing', async () => {
    try {
      const r = render(CalendarEventModal);
      await tick();
      await setInput(r.container, '#endTime', '18:00'); // 15:00–18:00
      // Typing "19:00" binds 01:00 after the first keystroke.
      for (const typed of ['01:00', '19:00']) {
        await setInput(r.container, '#startTime', typed);
      }
      await tick();
      expect(value(r, '#endTime')).toBe('22:00');
      expect(value(r, '#endDate')).toBe('2026-10-02');
    } finally {
      vi.useRealTimers();
    }
  });
});
