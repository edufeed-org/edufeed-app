// @ts-nocheck
/**
 * Editing a channel meeting: the same coordinate (kind 31923, same d-tag,
 * one group h-tag) is re-published to the group relay ONLY; a reschedule
 * keeps the already-shared guest link working (same code, new window),
 * posts a "Termin verschoben" notice into the channel and DMs the invitees.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let signedSeq = 0;
const publishToGroupRelay = vi.fn(async (_relay, template, user) => ({
  ...template,
  pubkey: user.pubkey,
  id: `signed-${++signedSeq}`,
  sig: 'sig'
}));
vi.mock('$lib/groups/group-management.js', () => ({
  publishToGroupRelay: (...a) => publishToGroupRelay(...a)
}));
const createMeetingLink = vi.fn(async () => ({
  code: 'N'.repeat(22),
  url: 'https://app.example/call/x#' + 'N'.repeat(22),
  event: { id: 'new-pass', kind: 9025 }
}));
const renewMeetingLink = vi.fn(async () => ({
  code: 'C'.repeat(22),
  url: 'https://app.example/call/x#' + 'C'.repeat(22),
  event: { id: 'renewed-pass', kind: 9025 },
  revoked: { id: 'revocation', kind: 5 },
  sameCode: true
}));
const revokeCallPass = vi.fn(async () => ({ id: 'revocation', kind: 5 }));
vi.mock('$lib/groups/call-passes.js', () => ({
  createMeetingLink: (...a) => createMeetingLink(...a),
  renewMeetingLink: (...a) => renewMeetingLink(...a),
  revokeCallPass: (...a) => revokeCallPass(...a)
}));
const sendWrappedDm = vi.fn(async () => {});
vi.mock('$lib/services/wrapped-dm.js', () => ({
  sendWrappedDm: (...a) => sendWrappedDm(...a)
}));
const eventStoreAdd = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (...a) => eventStoreAdd(...a) }
}));

const { updateGroupMeeting, meetingRescheduledText, notifyMeetingChange } = await import(
  '$lib/groups/edit-meeting.js'
);
const { formatTimeOfDay, formatTimestamp, formatTimeZoneName } = await import(
  '$lib/helpers/dates.js'
);

const ME = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const OUTSIDER = 'c'.repeat(64);
const NEWCOMER = 'd'.repeat(64);
const USER = { pubkey: ME, signer: {} };
const RELAY = { url: 'wss://groups.example/' };
const GROUP_MEETING = {
  pointer: { id: 'g1', relay: 'wss://groups.example/' },
  channelName: 'Arbeitszimmer',
  channelUrl: 'https://app.example/c/npub1x/g/g1',
  memberPubkeys: [ME, MEMBER],
  passesSupported: true
};
const OLD_URL = 'https://app.example/call/x#' + 'C'.repeat(22);
const NEW_URL = 'https://app.example/call/x#' + 'N'.repeat(22);

/** Local wall-clock form data `days` from now, at `hh`:00 for an hour. */
function formIn(days, hh = 10, extra = {}) {
  const d = new Date(Date.now() + days * 86400_000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const h2 = String(hh).padStart(2, '0');
  const e2 = String(hh + 1).padStart(2, '0');
  return {
    title: 'Elternabend',
    summary: 'Agenda folgt',
    image: '',
    startDate: iso,
    startTime: `${h2}:00`,
    endDate: iso,
    endTime: `${e2}:00`,
    startTimezone: 'Europe/Berlin',
    endTimezone: 'Europe/Berlin',
    location: 'https://elsewhere.example',
    isAllDay: false,
    eventType: 'time',
    references: [],
    participants: [{ pubkey: MEMBER }, { pubkey: OUTSIDER }, { name: 'Oma Erna' }],
    ...extra
  };
}

/** The stored meeting as the form above would have produced it (same day/time). */
function existingFor(form, { pubkey = ME, createdAt = 1_700_000_000 } = {}) {
  const start = Math.floor(new Date(`${form.startDate}T${form.startTime}`).getTime() / 1000);
  const end = Math.floor(new Date(`${form.endDate}T${form.endTime}`).getTime() / 1000);
  return {
    id: 'meeting-old',
    kind: 31923,
    pubkey,
    created_at: createdAt,
    content: 'Agenda folgt',
    tags: [
      ['d', 'meeting-abc'],
      ['h', 'g1'],
      ['title', 'Elternabend'],
      ['start', String(start)],
      ['end', String(end)],
      ['location', GROUP_MEETING.channelUrl],
      ['p', MEMBER],
      ['p', OUTSIDER],
      ['participant', 'Oma Erna', '', '']
    ]
  };
}
const pass = (pubkey = ME) => ({
  id: 'old-pass',
  kind: 9025,
  pubkey,
  created_at: 1,
  content: 'enc',
  tags: [
    ['h', 'g1'],
    ['expiration', String(Math.floor(Date.now() / 1000) + 86400)],
    ['a', `31923:${ME}:meeting-abc`, RELAY.url]
  ]
});

const nowS = Math.floor(Date.now() / 1000);
const base = (overrides = {}) => ({
  relayConn: RELAY,
  groupMeeting: GROUP_MEETING,
  user: USER,
  origin: 'https://app.example',
  allowGuests: false,
  guestPass: null,
  nowS,
  ...overrides
});

beforeEach(() => {
  signedSeq = 0;
  publishToGroupRelay.mockClear();
  createMeetingLink.mockClear();
  renewMeetingLink.mockClear();
  revokeCallPass.mockClear();
  sendWrappedDm.mockReset();
  sendWrappedDm.mockImplementation(async () => {});
  eventStoreAdd.mockClear();
});

describe('updateGroupMeeting', () => {
  it('re-publishes the SAME d-tag with exactly one group h-tag to the group relay only', async () => {
    const form = formIn(3, 10, { title: 'Elternabend (neu)', summary: 'Neue Agenda' });
    const existing = existingFor(formIn(3));
    const { event, rescheduled, guestStatus, noticeStatus } = await updateGroupMeeting(
      base({ formData: form, existing })
    );
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
    const [relayArg, template, userArg] = publishToGroupRelay.mock.calls[0];
    expect(relayArg).toBe(RELAY);
    expect(userArg).toBe(USER);
    expect(template.kind).toBe(31923);
    expect(template.content).toBe('Neue Agenda');
    expect(template.tags.filter((t) => t[0] === 'd')).toEqual([['d', 'meeting-abc']]);
    expect(template.tags.filter((t) => t[0] === 'h')).toEqual([['h', 'g1']]);
    expect(template.tags).toContainEqual(['title', 'Elternabend (neu)']);
    expect(template.tags).toContainEqual(['location', GROUP_MEETING.channelUrl]);
    // Replaceable: the relay keeps the newer created_at.
    expect(template.created_at).toBeGreaterThan(existing.created_at);
    expect(eventStoreAdd).toHaveBeenCalledWith(event);
    expect(rescheduled).toBe(false);
    expect(guestStatus).toBe('off');
    expect(noticeStatus).toBe('none');
    expect(createMeetingLink).not.toHaveBeenCalled();
    expect(renewMeetingLink).not.toHaveBeenCalled();
  });

  it('stamps created_at after the stored event even when the clock is behind it', async () => {
    const existing = existingFor(formIn(3), { createdAt: nowS + 500 });
    await updateGroupMeeting(base({ formData: formIn(3), existing }));
    expect(publishToGroupRelay.mock.calls[0][1].created_at).toBe(nowS + 501);
  });

  it('refuses to edit someone else’s meeting or a meeting of another channel', async () => {
    await expect(
      updateGroupMeeting(
        base({ formData: formIn(3), existing: existingFor(formIn(3), { pubkey: MEMBER }) })
      )
    ).rejects.toThrow(/author/);
    const foreign = existingFor(formIn(3));
    foreign.tags = foreign.tags.map((t) => (t[0] === 'h' ? ['h', 'other'] : t));
    await expect(
      updateGroupMeeting(base({ formData: formIn(3), existing: foreign }))
    ).rejects.toThrow();
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });

  it('on a reschedule posts a "Termin verschoben" notice (kind 9) into the channel', async () => {
    const existing = existingFor(formIn(3));
    const form = formIn(4, 14);
    const { rescheduled, previous, start, noticeStatus } = await updateGroupMeeting(
      base({ formData: form, existing })
    );
    expect(rescheduled).toBe(true);
    expect(previous.start).toBe(Number(existing.tags.find((t) => t[0] === 'start')[1]));
    expect(publishToGroupRelay).toHaveBeenCalledTimes(2);
    const [, notice] = publishToGroupRelay.mock.calls[1];
    expect(notice.kind).toBe(9);
    expect(notice.tags.filter((t) => t[0] === 'h')).toEqual([['h', 'g1']]);
    expect(notice.content).toBe(
      meetingRescheduledText({ title: 'Elternabend', start, previousStart: previous.start })
    );
    expect(notice.content).toContain(formatTimeOfDay(start));
    expect(notice.content).toContain(formatTimeOfDay(previous.start));
    expect(noticeStatus).toBe('sent');
    expect(eventStoreAdd).toHaveBeenCalledTimes(2);
  });

  it('a failed notice never undoes the edit', async () => {
    publishToGroupRelay
      .mockImplementationOnce(async (_r, t, u) => ({ ...t, pubkey: u.pubkey, id: 'm' }))
      .mockRejectedValueOnce(new Error('rate-limited'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { event, noticeStatus } = await updateGroupMeeting(
      base({ formData: formIn(4, 14), existing: existingFor(formIn(3)) })
    );
    expect(event.id).toBe('m');
    expect(noticeStatus).toBe('failed');
    warn.mockRestore();
  });

  it('posts no notice when only title or description changed', async () => {
    await updateGroupMeeting(
      base({ formData: formIn(3, 10, { title: 'Anders' }), existing: existingFor(formIn(3)) })
    );
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
  });

  describe('guest link', () => {
    it('keeps an existing pass untouched when the time did not change', async () => {
      const { guestStatus, guestUrl } = await updateGroupMeeting(
        base({
          formData: formIn(3, 10, { title: 'Anders' }),
          existing: existingFor(formIn(3)),
          allowGuests: true,
          guestPass: pass()
        })
      );
      expect(guestStatus).toBe('kept');
      expect(guestUrl).toBeNull();
      expect(renewMeetingLink).not.toHaveBeenCalled();
      expect(createMeetingLink).not.toHaveBeenCalled();
      expect(revokeCallPass).not.toHaveBeenCalled();
    });

    it('renews the pass with the same code on a reschedule, so the shared URL keeps working', async () => {
      const existing = existingFor(formIn(3));
      const { guestStatus, guestUrl, start, end, event } = await updateGroupMeeting(
        base({ formData: formIn(4, 14), existing, allowGuests: true, guestPass: pass() })
      );
      expect(guestStatus).toBe('renewed');
      expect(guestUrl).toBe(OLD_URL);
      expect(renewMeetingLink).toHaveBeenCalledWith(
        RELAY,
        GROUP_MEETING.pointer,
        USER,
        'https://app.example',
        expect.objectContaining({ id: 'old-pass' }),
        { start, end, coordinate: `31923:${ME}:meeting-abc`, title: 'Elternabend' }
      );
      expect(event.tags.find((t) => t[0] === 'd')[1]).toBe('meeting-abc');
      // New pass and the revocation of the old one reach the store: the card
      // offers the current link at once.
      expect(eventStoreAdd).toHaveBeenCalledWith({ id: 'renewed-pass', kind: 9025 });
      expect(eventStoreAdd).toHaveBeenCalledWith({ id: 'revocation', kind: 5 });
    });

    it('reports a changed URL when the old code could not be reused', async () => {
      renewMeetingLink.mockResolvedValueOnce({
        code: 'N'.repeat(22),
        url: NEW_URL,
        event: { id: 'fresh', kind: 9025 },
        revoked: null,
        sameCode: false
      });
      const { guestStatus, guestUrl } = await updateGroupMeeting(
        base({
          formData: formIn(4, 14),
          existing: existingFor(formIn(3)),
          allowGuests: true,
          guestPass: pass()
        })
      );
      expect(guestStatus).toBe('created');
      expect(guestUrl).toBe(NEW_URL);
    });

    it('mints a new pass when guests are switched on for a meeting without one', async () => {
      const { guestStatus, guestUrl, start, end } = await updateGroupMeeting(
        base({ formData: formIn(3), existing: existingFor(formIn(3)), allowGuests: true })
      );
      expect(guestStatus).toBe('created');
      expect(guestUrl).toBe(NEW_URL);
      expect(createMeetingLink).toHaveBeenCalledWith(
        RELAY,
        GROUP_MEETING.pointer,
        USER,
        'https://app.example',
        {
          start,
          end,
          coordinate: `31923:${ME}:meeting-abc`,
          title: 'Elternabend'
        }
      );
      expect(eventStoreAdd).toHaveBeenCalledWith({ id: 'new-pass', kind: 9025 });
    });

    it('revokes the pass when guests are switched off', async () => {
      const { guestStatus } = await updateGroupMeeting(
        base({
          formData: formIn(3),
          existing: existingFor(formIn(3)),
          allowGuests: false,
          guestPass: pass()
        })
      );
      expect(guestStatus).toBe('revoked');
      expect(revokeCallPass).toHaveBeenCalledWith(
        RELAY,
        expect.objectContaining({ id: 'old-pass' }),
        USER
      );
      expect(eventStoreAdd).toHaveBeenCalledWith({ id: 'revocation', kind: 5 });
    });

    it('revokes a pass the relay could not re-window (meeting moved beyond 60 days)', async () => {
      const { guestStatus } = await updateGroupMeeting(
        base({
          formData: formIn(61),
          existing: existingFor(formIn(3)),
          allowGuests: true,
          guestPass: pass()
        })
      );
      expect(guestStatus).toBe('too_far');
      expect(renewMeetingLink).not.toHaveBeenCalled();
      expect(revokeCallPass).toHaveBeenCalledTimes(1);
    });

    it('never touches a pass that is not mine, and keeps the meeting when the pass step fails', async () => {
      const { guestStatus: foreign } = await updateGroupMeeting(
        base({
          formData: formIn(4, 14),
          existing: existingFor(formIn(3)),
          allowGuests: true,
          guestPass: pass(MEMBER)
        })
      );
      expect(renewMeetingLink).not.toHaveBeenCalled();
      expect(foreign).toBe('created');

      renewMeetingLink.mockRejectedValueOnce(new Error('nip44-unsupported'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { event, guestStatus } = await updateGroupMeeting(
        base({
          formData: formIn(4, 14),
          existing: existingFor(formIn(3)),
          allowGuests: true,
          guestPass: pass()
        })
      );
      expect(event.kind).toBe(31923);
      expect(guestStatus).toBe('failed');
      warn.mockRestore();
    });
  });
});

describe('meetingRescheduledText', () => {
  it('names title, the new date/time with zone and the previous one', () => {
    const start = 1_800_000_000;
    const previousStart = 1_799_900_000;
    const text = meetingRescheduledText({ title: 'Elternabend', start, previousStart });
    expect(text).toContain('Elternabend');
    expect(text).toContain(
      formatTimestamp(start, { day: '2-digit', month: '2-digit', year: 'numeric' })
    );
    expect(text).toContain(formatTimeOfDay(start));
    expect(text).toContain(formatTimeZoneName(start));
    expect(text).toContain(
      formatTimestamp(previousStart, { day: '2-digit', month: '2-digit', year: 'numeric' })
    );
    expect(text).toContain(formatTimeOfDay(previousStart));
  });
});

describe('notifyMeetingChange', () => {
  const common = {
    self: ME,
    memberPubkeys: [ME, MEMBER],
    title: 'Elternabend',
    start: 1_800_000_000,
    previousStart: 1_799_900_000,
    channelName: 'Arbeitszimmer',
    channelUrl: GROUP_MEETING.channelUrl,
    guestUrl: OLD_URL
  };

  it('on a reschedule DMs every existing invitee once, the guest link only to non-members', async () => {
    const result = await notifyMeetingChange({
      ...common,
      rescheduled: true,
      participants: [{ pubkey: MEMBER }, { pubkey: OUTSIDER }, { pubkey: ME }, { name: 'Oma' }],
      previousParticipants: [MEMBER, OUTSIDER]
    });
    expect(sendWrappedDm).toHaveBeenCalledTimes(2);
    const byRecipient = Object.fromEntries(sendWrappedDm.mock.calls.map(([pk, t]) => [pk, t]));
    expect(byRecipient[MEMBER]).toContain(formatTimeOfDay(common.start));
    expect(byRecipient[MEMBER]).toContain(formatTimeOfDay(common.previousStart));
    expect(byRecipient[MEMBER]).not.toContain(OLD_URL);
    expect(byRecipient[OUTSIDER]).toContain(OLD_URL);
    expect(result).toEqual({ sent: 2, failed: [] });
  });

  it('sends newly added invitees an invitation, not a reschedule notice', async () => {
    await notifyMeetingChange({
      ...common,
      rescheduled: false,
      participants: [{ pubkey: MEMBER }, { pubkey: NEWCOMER }],
      previousParticipants: [MEMBER]
    });
    expect(sendWrappedDm).toHaveBeenCalledTimes(1);
    const [pk, text] = sendWrappedDm.mock.calls[0];
    expect(pk).toBe(NEWCOMER);
    expect(text).not.toContain(formatTimeOfDay(common.previousStart));
    expect(text).toContain(OLD_URL);
  });

  it('sends nothing to existing invitees when the time did not change', async () => {
    await notifyMeetingChange({
      ...common,
      rescheduled: false,
      participants: [{ pubkey: MEMBER }, { pubkey: OUTSIDER }],
      previousParticipants: [MEMBER, OUTSIDER]
    });
    expect(sendWrappedDm).not.toHaveBeenCalled();
  });

  it('collects per-invitee failures instead of throwing', async () => {
    sendWrappedDm.mockImplementation(async (pk) => {
      if (pk === OUTSIDER) throw new Error('no relays');
    });
    const result = await notifyMeetingChange({
      ...common,
      rescheduled: true,
      participants: [{ pubkey: MEMBER }, { pubkey: OUTSIDER }],
      previousParticipants: [MEMBER, OUTSIDER]
    });
    expect(result).toEqual({ sent: 1, failed: [OUTSIDER] });
  });
});
