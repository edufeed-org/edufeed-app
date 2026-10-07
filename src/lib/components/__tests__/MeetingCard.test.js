// @ts-nocheck
/**
 * MeetingCard — a scheduled meeting (kind 31923) inside a NIP-29 channel's
 * timeline: time, status by phase, join, .ics, the organiser's guest link and
 * deleting (which revokes the pass — meeting-actions.js has that logic).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import * as m from '$lib/paraglide/messages';
import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';

const MY_SK = generateSecretKey();
const OTHER_SK = generateSecretKey();
const ME = getPublicKey(MY_SK);
const OTHER = getPublicKey(OTHER_SK);
const RELAY = 'wss://groups.example/';
const POINTER = { id: 'g1', relay: RELAY };
const GUEST_URL = 'https://app.example/call/x#' + 'C'.repeat(22);

const h = vi.hoisted(() => ({
  listCallPasses: null,
  passLinkFor: null,
  deleteMeeting: null,
  showToast: null
}));
h.listCallPasses = vi.fn(async () => []);
h.passLinkFor = vi.fn(async () => GUEST_URL);
h.deleteMeeting = vi.fn();
h.showToast = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  return { eventStore, pool: { relay: (url) => ({ url }) } };
});
vi.mock('$lib/groups/call-passes.js', async (orig) => ({
  ...(await orig()),
  listCallPasses: (...a) => h.listCallPasses(...a),
  passLinkFor: (...a) => h.passLinkFor(...a)
}));
vi.mock('$lib/groups/meeting-actions.js', () => ({
  deleteMeeting: (...a) => h.deleteMeeting(...a)
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock('$lib/helpers/toast', () => ({ showToast: (...a) => h.showToast(...a) }));

const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const { default: MeetingCard } = await import('$lib/components/groups/MeetingCard.svelte');

const signer = {
  signEvent: async (e) => e,
  nip44: { encrypt: async (_p, t) => t, decrypt: async (_p, c) => c }
};
const me = { pubkey: ME, signer };

let seq = 0;
/** A meeting by `sk` starting `inS` seconds from now, lasting an hour. */
function meetingIn(inS, { sk = MY_SK, title = 'Elternabend', content = 'Bitte pünktlich' } = {}) {
  const start = Math.floor(Date.now() / 1000) + inS;
  seq++;
  return finalizeEvent(
    {
      kind: 31923,
      created_at: Math.floor(Date.now() / 1000) - seq,
      content,
      tags: [
        ['d', `meeting-${seq}`],
        ['title', title],
        ['start', String(start)],
        ['end', String(start + 3600)],
        ['location', 'https://app.example/c/npub1x?channel=g1'],
        ['h', 'g1'],
        ['p', OTHER],
        ['p', OTHER],
        ['participant', 'Erna', '', '']
      ]
    },
    sk
  );
}

/** A meeting pass of mine linked to `meeting`. */
function passFor(meeting) {
  const coordinate = `31923:${meeting.pubkey}:${meeting.tags.find((t) => t[0] === 'd')[1]}`;
  return finalizeEvent(
    {
      kind: 9025,
      created_at: Math.floor(Date.now() / 1000),
      content: 'C'.repeat(22),
      tags: [
        ['h', 'g1'],
        ['code-hash', 'f'.repeat(64)],
        ['expiration', String(Math.floor(Date.now() / 1000) + 86400)],
        ['a', coordinate, RELAY]
      ]
    },
    MY_SK
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.listCallPasses.mockImplementation(async () => []);
  h.passLinkFor.mockImplementation(async () => GUEST_URL);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MeetingCard', () => {
  it('shows title, DD.MM.YYYY HH:MM–HH:MM, description and the invitees once each', () => {
    const event = meetingIn(3 * 3600);
    render(MeetingCard, { props: { event, pointer: POINTER, user: me, isAdmin: false } });
    const start = Number(event.tags.find((t) => t[0] === 'start')[1]);
    expect(screen.getByTestId('meeting-card-title').textContent).toBe('Elternabend');
    // Task 19: the status chip is decoration, the title stays selectable text.
    const status = screen.getByTestId('meeting-card-status');
    expect(status.classList.contains('cursor-default')).toBe(true);
    expect(status.classList.contains('select-none')).toBe(true);
    expect(screen.getByTestId('meeting-card-title').classList.contains('select-none')).toBe(false);
    const date = formatTimestamp(start, { day: '2-digit', month: '2-digit', year: 'numeric' });
    expect(screen.getByTestId('meeting-card-time').textContent.trim()).toBe(
      `${date} ${formatTimeOfDay(start)}–${formatTimeOfDay(start + 3600)}`
    );
    expect(screen.getByText('Bitte pünktlich')).toBeTruthy();
    // The duplicated p tag must not crash the keyed list, and shows once.
    expect(screen.getAllByTestId('profile-avatar-stub')).toHaveLength(1);
    expect(screen.getByText('Erna')).toBeTruthy();
    expect(screen.getByTestId('meeting-card-status').textContent).toBe(m.meeting_status_upcoming());
  });

  it('keeps "Beitreten" disabled until 15 minutes before the start', async () => {
    const onJoin = vi.fn();
    render(MeetingCard, {
      props: { event: meetingIn(2 * 3600), pointer: POINTER, user: me, isAdmin: false, onJoin }
    });
    const join = screen.getByTestId('meeting-card-join');
    expect(join.disabled).toBe(true);
    expect(join.getAttribute('title')).toBe(m.meeting_card_join_hint());
  });

  it('offers "Beitreten" in the join window and calls the channel join', async () => {
    const onJoin = vi.fn();
    render(MeetingCard, {
      props: { event: meetingIn(10 * 60), pointer: POINTER, user: me, isAdmin: false, onJoin }
    });
    expect(screen.getByTestId('meeting-card-status').textContent).toBe(m.meeting_status_joinable());
    const join = screen.getByTestId('meeting-card-join');
    expect(join.disabled).toBe(false);
    await fireEvent.click(join);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates the phase every 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const onJoin = vi.fn();
    // 15 min 20 s ahead: upcoming now, joinable 30 s later.
    render(MeetingCard, {
      props: { event: meetingIn(15 * 60 + 20), pointer: POINTER, user: me, isAdmin: false, onJoin }
    });
    expect(screen.getByTestId('meeting-card-join').disabled).toBe(true);
    vi.advanceTimersByTime(30_000);
    await tick();
    expect(screen.getByTestId('meeting-card-join').disabled).toBe(false);
  });

  // QA round 3 K3: the 30 s clock alone enabled "Beitreten" up to a minute
  // late; a timer at the next phase boundary flips it on time.
  it('flips to joinable exactly at the window, not at the next 30 s tick', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']
    });
    const onJoin = vi.fn();
    render(MeetingCard, {
      props: { event: meetingIn(15 * 60 + 5), pointer: POINTER, user: me, isAdmin: false, onJoin }
    });
    expect(screen.getByTestId('meeting-card-join').disabled).toBe(true);
    vi.advanceTimersByTime(6_000);
    await tick();
    expect(screen.getByTestId('meeting-card-join').disabled).toBe(false);
  });

  it('a past meeting offers join only while the channel call still runs', async () => {
    const event = meetingIn(-2 * 3600);
    const onJoin = vi.fn();
    const r = render(MeetingCard, {
      props: { event, pointer: POINTER, user: me, isAdmin: false, onJoin, callRunning: false }
    });
    expect(screen.getByTestId('meeting-card-status').textContent).toBe(m.meeting_status_past());
    expect(screen.queryByTestId('meeting-card-join')).toBeNull();
    await r.rerender({
      event,
      pointer: POINTER,
      user: me,
      isAdmin: false,
      onJoin,
      callRunning: true
    });
    expect(screen.getByTestId('meeting-card-join').disabled).toBe(false);
  });

  it('has no join button for someone who cannot join (no onJoin)', () => {
    render(MeetingCard, {
      props: { event: meetingIn(60), pointer: POINTER, user: null, isAdmin: false }
    });
    expect(screen.queryByTestId('meeting-card-join')).toBeNull();
  });

  it('downloads an .ics of the meeting', async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return 'blob:ics';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(MeetingCard, {
      props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: false }
    });
    await fireEvent.click(screen.getByTestId('meeting-card-ics'));
    expect(click).toHaveBeenCalled();
    const text = await created[0].text();
    expect(text).toContain('SUMMARY:Elternabend');
    expect(text).toContain('URL:https://app.example/c/npub1x?channel=g1');
    expect(click.mock.contexts[0].download).toBe('Elternabend.ics');
    click.mockRestore();
  });

  it('stamps the .ics with SEQUENCE/LAST-MODIFIED from created_at, so a re-import replaces the entry', async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return 'blob:ics';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const event = meetingIn(3600);
    render(MeetingCard, { props: { event, pointer: POINTER, user: me, isAdmin: false } });
    await fireEvent.click(screen.getByTestId('meeting-card-ics'));
    // Unfold first: the UID line (coordinate = 64-hex pubkey) exceeds the
    // 75-octet limit and is folded with CRLF + space.
    const text = (await created[0].text()).replace(/\r\n /g, '');
    expect(text).toContain(`UID:31923:${ME}:${event.tags.find((t) => t[0] === 'd')[1]}@edufeed`);
    expect(text).toContain(`SEQUENCE:${event.created_at}`);
    expect(text).toMatch(/LAST-MODIFIED:\d{8}T\d{6}Z/);
    click.mockRestore();
  });

  describe('edit', () => {
    it('offers "Bearbeiten" to the author only, handing the meeting and its pass to the opener', async () => {
      const onEdit = vi.fn();
      const event = meetingIn(3600);
      const pass = passFor(event);
      eventStore.add(pass);
      render(MeetingCard, {
        props: { event, pointer: POINTER, user: me, isAdmin: false, onEdit }
      });
      await screen.findByTestId('meeting-card-guest-link');
      const button = screen.getByTestId('meeting-card-edit');
      expect(button.textContent?.trim()).toBe(m.meeting_card_edit());
      expect(button.className).toContain('btn-sm');
      await fireEvent.click(button);
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0][0].id).toBe(event.id);
      expect(onEdit.mock.calls[0][1].id).toBe(pass.id);
    });

    it('hands a null pass when the meeting has none', async () => {
      const onEdit = vi.fn();
      const event = meetingIn(3600);
      render(MeetingCard, {
        props: { event, pointer: POINTER, user: me, isAdmin: false, onEdit }
      });
      await fireEvent.click(screen.getByTestId('meeting-card-edit'));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: event.id }), null);
    });

    it('is not offered to an admin who is not the author, nor without an opener', () => {
      render(MeetingCard, {
        props: {
          event: meetingIn(3600, { sk: OTHER_SK }),
          pointer: POINTER,
          user: me,
          isAdmin: true,
          onEdit: vi.fn()
        }
      });
      render(MeetingCard, {
        props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: false }
      });
      expect(screen.queryByTestId('meeting-card-edit')).toBeNull();
    });
  });

  describe('guest link', () => {
    it("rebuilds the organiser's guest link from the pass in the store and copies it", async () => {
      const event = meetingIn(3600);
      const pass = passFor(event);
      eventStore.add(pass);
      render(MeetingCard, { props: { event, pointer: POINTER, user: me, isAdmin: false } });
      const button = await screen.findByTestId('meeting-card-guest-link');
      await fireEvent.click(button);
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GUEST_URL));
      expect(h.passLinkFor.mock.calls[0][0].id).toBe(pass.id);
      expect(h.passLinkFor.mock.calls[0][2]).toEqual(POINTER);
      expect(h.showToast).toHaveBeenCalledWith(m.meeting_card_guest_link_copied(), 'success');
    });

    it('picks up a pass that reaches the store later (just scheduled, or listed by the chat)', async () => {
      const event = meetingIn(3600);
      render(MeetingCard, { props: { event, pointer: POINTER, user: me, isAdmin: false } });
      await tick();
      expect(screen.queryByTestId('meeting-card-guest-link')).toBeNull();
      eventStore.add(passFor(event));
      expect(await screen.findByTestId('meeting-card-guest-link')).toBeTruthy();
    });

    // One listing per channel visit lives in GroupChat; a card never fetches.
    it('never lists passes itself', async () => {
      render(MeetingCard, {
        props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: false }
      });
      await tick();
      expect(h.listCallPasses).not.toHaveBeenCalled();
      expect(screen.queryByTestId('meeting-card-guest-link')).toBeNull();
    });

    it('offers no guest link for a past meeting or someone else’s', async () => {
      const past = meetingIn(-3 * 3600);
      eventStore.add(passFor(past));
      render(MeetingCard, { props: { event: past, pointer: POINTER, user: me, isAdmin: false } });
      const theirs = meetingIn(3600, { sk: OTHER_SK });
      render(MeetingCard, { props: { event: theirs, pointer: POINTER, user: me, isAdmin: true } });
      await tick();
      expect(screen.queryByTestId('meeting-card-guest-link')).toBeNull();
    });
  });

  describe('delete', () => {
    it('is offered to the author and to a channel admin, not to other members', () => {
      render(MeetingCard, {
        props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: false }
      });
      expect(screen.getAllByTestId('meeting-card-delete')).toHaveLength(1);
      render(MeetingCard, {
        props: {
          event: meetingIn(3600, { sk: OTHER_SK }),
          pointer: POINTER,
          user: me,
          isAdmin: false
        }
      });
      expect(screen.getAllByTestId('meeting-card-delete')).toHaveLength(1);
      render(MeetingCard, {
        props: {
          event: meetingIn(3600, { sk: OTHER_SK }),
          pointer: POINTER,
          user: me,
          isAdmin: true
        }
      });
      expect(screen.getAllByTestId('meeting-card-delete')).toHaveLength(2);
    });

    // Final review 4: same dialog semantics as CallSwitchConfirmModal.
    it('the confirm is a labelled modal alertdialog', async () => {
      render(MeetingCard, {
        props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: true }
      });
      await fireEvent.click(screen.getByTestId('meeting-card-delete'));
      const dialog = screen.getByTestId('meeting-card-delete-dialog');
      expect(dialog.getAttribute('role')).toBe('alertdialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const heading = document.getElementById(dialog.getAttribute('aria-labelledby'));
      expect(heading?.textContent).toBe(m.meeting_card_delete_confirm_title());
    });

    it('asks first, then deletes on the group relay and drops the meeting locally', async () => {
      const event = meetingIn(3600);
      eventStore.add(event);
      const deletion = finalizeEvent(
        {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000) + 1,
          content: '',
          tags: [
            ['e', event.id],
            ['h', 'g1']
          ]
        },
        MY_SK
      );
      h.deleteMeeting.mockImplementation(async () => deletion);
      render(MeetingCard, { props: { event, pointer: POINTER, user: me, isAdmin: true } });
      await fireEvent.click(screen.getByTestId('meeting-card-delete'));
      expect(h.deleteMeeting).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByTestId('meeting-card-delete-confirm'));
      await waitFor(() => expect(h.deleteMeeting).toHaveBeenCalledTimes(1));
      expect(h.deleteMeeting).toHaveBeenCalledWith({
        relayConn: { url: RELAY },
        event,
        user: me,
        asAdmin: true
      });
      await waitFor(() => expect(eventStore.getEvent(event.id)).toBeFalsy());
      expect(h.showToast).toHaveBeenCalledWith(m.meeting_card_deleted(), 'success');
    });

    it('keeps the dialog and says so when deleting fails', async () => {
      h.deleteMeeting.mockRejectedValue(new Error('relay said no'));
      render(MeetingCard, {
        props: { event: meetingIn(3600), pointer: POINTER, user: me, isAdmin: false }
      });
      await fireEvent.click(screen.getByTestId('meeting-card-delete'));
      await fireEvent.click(screen.getByTestId('meeting-card-delete-confirm'));
      await waitFor(() =>
        expect(h.showToast).toHaveBeenCalledWith(m.meeting_card_delete_failed(), 'error')
      );
      expect(screen.getByTestId('meeting-card-delete-confirm')).toBeTruthy();
    });
  });
});
