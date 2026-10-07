// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishToGroupRelay = vi.fn(async (_relay, template, user) => ({
  ...template,
  pubkey: user.pubkey,
  id: 'meeting-id',
  sig: 'sig'
}));
vi.mock('$lib/groups/group-management.js', () => ({
  publishToGroupRelay: (...a) => publishToGroupRelay(...a)
}));
const createMeetingLink = vi.fn(async () => ({
  code: 'C'.repeat(22),
  url: 'https://app.example/call/x#' + 'C'.repeat(22),
  event: { id: 'pass-id' }
}));
vi.mock('$lib/groups/call-passes.js', () => ({
  createMeetingLink: (...a) => createMeetingLink(...a)
}));
const enableGroupCalls = vi.fn(async () => {});
vi.mock('$lib/groups/enable-group-calls.js', () => ({
  enableGroupCalls: (...a) => enableGroupCalls(...a)
}));
const sendWrappedDm = vi.fn(async () => {});
vi.mock('$lib/services/wrapped-dm.js', () => ({
  sendWrappedDm: (...a) => sendWrappedDm(...a)
}));
const eventStoreAdd = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (...a) => eventStoreAdd(...a) }
}));

const { scheduleGroupMeeting, sendMeetingInvites, meetingInviteText } = await import(
  '$lib/groups/schedule-meeting.js'
);
const { formatTimeOfDay, formatTimestamp, formatTimeZoneName } = await import(
  '$lib/helpers/dates.js'
);

const ME = 'a'.repeat(64);
const MEMBER = 'b'.repeat(64);
const OUTSIDER = 'c'.repeat(64);
const USER = { pubkey: ME, signer: {} };
const RELAY = { url: 'wss://groups.example/' };
const GROUP_MEETING = {
  pointer: { id: 'g1', relay: 'wss://groups.example/' },
  channelName: 'Arbeitszimmer',
  channelUrl: 'https://app.example/c/npub1x/g/g1',
  memberPubkeys: [ME, MEMBER]
};
const GUEST_URL = 'https://app.example/call/x#' + 'C'.repeat(22);

/** Local wall-clock form data `days` from now, 10:00–11:00. */
function formIn(days) {
  const d = new Date(Date.now() + days * 86400_000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  return {
    title: 'Elternabend',
    summary: 'Agenda folgt',
    image: '',
    startDate: iso,
    startTime: '10:00',
    endDate: iso,
    endTime: '11:00',
    startTimezone: 'Europe/Berlin',
    endTimezone: 'Europe/Berlin',
    location: 'https://elsewhere.example',
    isAllDay: false,
    eventType: 'time',
    references: [],
    participants: [{ pubkey: MEMBER }, { pubkey: OUTSIDER }, { name: 'Oma Erna' }]
  };
}

beforeEach(() => {
  publishToGroupRelay.mockClear();
  createMeetingLink.mockClear();
  enableGroupCalls.mockReset();
  enableGroupCalls.mockImplementation(async () => {});
  sendWrappedDm.mockReset();
  sendWrappedDm.mockImplementation(async () => {});
  eventStoreAdd.mockClear();
});

describe('scheduleGroupMeeting', () => {
  it('publishes a 31923 with exactly one group h-tag to the group relay only', async () => {
    const { event, guestStatus } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(3),
      groupMeeting: GROUP_MEETING,
      user: USER,
      origin: 'https://app.example',
      allowGuests: false
    });
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
    const [relayArg, template, userArg] = publishToGroupRelay.mock.calls[0];
    expect(relayArg).toBe(RELAY);
    expect(userArg).toBe(USER);
    expect(template.kind).toBe(31923);
    expect(template.content).toBe('Agenda folgt');
    expect(template.tags.filter((t) => t[0] === 'h')).toEqual([['h', 'g1']]);
    expect(template.tags).toContainEqual(['location', GROUP_MEETING.channelUrl]);
    expect(template.tags.find((t) => t[0] === 'd')[1]).toMatch(/^meeting-/);
    expect(template.tags).toContainEqual(['title', 'Elternabend']);
    expect(template.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([MEMBER, OUTSIDER]);
    expect(eventStoreAdd).toHaveBeenCalledWith(event);
    expect(createMeetingLink).not.toHaveBeenCalled();
    expect(guestStatus).toBe('off');
  });

  it('mints a guest link tied to the meeting coordinate when guests are allowed', async () => {
    const formData = formIn(3);
    const { event, start, end, guestUrl, guestStatus } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData,
      groupMeeting: GROUP_MEETING,
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(end - start).toBe(3600);
    expect(guestStatus).toBe('created');
    expect(guestUrl).toBe(GUEST_URL);
    const dTag = event.tags.find((t) => t[0] === 'd')[1];
    expect(createMeetingLink).toHaveBeenCalledWith(
      RELAY,
      GROUP_MEETING.pointer,
      USER,
      'https://app.example',
      { start, end, coordinate: `31923:${ME}:${dTag}`, title: 'Elternabend' }
    );
    // The code never enters the public event.
    expect(JSON.stringify(event)).not.toContain('C'.repeat(22));
    // The pass goes into the local store, so the meeting card finds it at
    // once ("Gast-Link kopieren") without racing the relay.
    expect(eventStoreAdd).toHaveBeenCalledWith({ id: 'pass-id' });
  });

  it('creates the meeting without a pass when it ends beyond the 60-day pass limit', async () => {
    const { guestUrl, guestStatus } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(61),
      groupMeeting: GROUP_MEETING,
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(publishToGroupRelay).toHaveBeenCalledTimes(1);
    expect(createMeetingLink).not.toHaveBeenCalled();
    expect(guestStatus).toBe('too_far');
    expect(guestUrl).toBeNull();
  });

  it('keeps the meeting when minting the guest link fails', async () => {
    createMeetingLink.mockRejectedValueOnce(new Error('nip44-unsupported'));
    const { event, guestStatus, guestUrl } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(3),
      groupMeeting: GROUP_MEETING,
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(event.id).toBe('meeting-id');
    expect(guestStatus).toBe('failed');
    expect(guestUrl).toBeNull();
  });

  // Issue d0ab04d0: a community's General channel starts without calls, so its
  // organiser never saw a guest option. An admin who may switch calls on gets
  // the option, and the switch happens here, right before the link is minted.
  it('switches calls on before minting the link when the channel has none and the organiser may', async () => {
    const order = [];
    enableGroupCalls.mockImplementation(async () => {
      order.push('enable');
    });
    createMeetingLink.mockImplementationOnce(async () => {
      order.push('mint');
      return { code: 'C'.repeat(22), url: GUEST_URL, event: { id: 'pass-id' } };
    });
    const { guestStatus, guestUrl } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(3),
      groupMeeting: { ...GROUP_MEETING, callsEnabled: false, canEnableCalls: true },
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(enableGroupCalls).toHaveBeenCalledWith(GROUP_MEETING.pointer, USER);
    expect(order).toEqual(['enable', 'mint']);
    expect(guestStatus).toBe('created');
    expect(guestUrl).toBe(GUEST_URL);
  });

  it('leaves the channel alone when calls are on, the organiser may not switch them on, or no guests are wanted', async () => {
    const base = {
      relayConn: RELAY,
      formData: formIn(3),
      user: USER,
      origin: 'https://app.example'
    };
    await scheduleGroupMeeting({
      ...base,
      groupMeeting: { ...GROUP_MEETING, callsEnabled: true, canEnableCalls: false },
      allowGuests: true
    });
    await scheduleGroupMeeting({
      ...base,
      groupMeeting: { ...GROUP_MEETING, callsEnabled: false, canEnableCalls: false },
      allowGuests: true
    });
    await scheduleGroupMeeting({
      ...base,
      groupMeeting: { ...GROUP_MEETING, callsEnabled: false, canEnableCalls: true },
      allowGuests: false
    });
    expect(enableGroupCalls).not.toHaveBeenCalled();
  });

  it('keeps the meeting without a link when switching calls on fails', async () => {
    enableGroupCalls.mockRejectedValueOnce(new Error('restricted: not an admin'));
    const { event, guestStatus, guestUrl } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(3),
      groupMeeting: { ...GROUP_MEETING, callsEnabled: false, canEnableCalls: true },
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(event.id).toBe('meeting-id');
    expect(createMeetingLink).not.toHaveBeenCalled();
    expect(guestStatus).toBe('failed');
    expect(guestUrl).toBeNull();
  });

  it('does not switch calls on for a meeting beyond the pass limit', async () => {
    const { guestStatus } = await scheduleGroupMeeting({
      relayConn: RELAY,
      formData: formIn(70),
      groupMeeting: { ...GROUP_MEETING, callsEnabled: false, canEnableCalls: true },
      user: USER,
      origin: 'https://app.example',
      allowGuests: true
    });
    expect(guestStatus).toBe('too_far');
    expect(enableGroupCalls).not.toHaveBeenCalled();
  });

  it('propagates a relay rejection of the meeting itself', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('blocked: not a member'));
    await expect(
      scheduleGroupMeeting({
        relayConn: RELAY,
        formData: formIn(3),
        groupMeeting: GROUP_MEETING,
        user: USER,
        origin: 'https://app.example',
        allowGuests: true
      })
    ).rejects.toThrow('blocked');
    expect(createMeetingLink).not.toHaveBeenCalled();
  });
});

describe('meetingInviteText', () => {
  const start = 1_800_000_000;
  it('names title, date, time, channel and channel link, without a guest link for members', () => {
    const text = meetingInviteText({
      title: 'Elternabend',
      start,
      channelName: 'Arbeitszimmer',
      channelUrl: GROUP_MEETING.channelUrl
    });
    expect(text).toContain('Elternabend');
    expect(text).toContain(
      formatTimestamp(start, { day: '2-digit', month: '2-digit', year: 'numeric' })
    );
    expect(text).toContain(formatTimeOfDay(start));
    // Invitees may live elsewhere: the time says which zone it is in.
    expect(text).toContain(formatTimeZoneName(start));
    expect(formatTimeZoneName(start)).not.toBe('');
    expect(text).toContain('Arbeitszimmer');
    expect(text).toContain(GROUP_MEETING.channelUrl);
    expect(text).not.toContain('/call/');
  });
  it('adds the guest link when given', () => {
    const text = meetingInviteText({
      title: 'Elternabend',
      start,
      channelName: 'Arbeitszimmer',
      channelUrl: GROUP_MEETING.channelUrl,
      guestUrl: GUEST_URL
    });
    expect(text).toContain(GUEST_URL);
  });
});

describe('sendMeetingInvites', () => {
  const base = {
    title: 'Elternabend',
    start: 1_800_000_000,
    channelName: 'Arbeitszimmer',
    channelUrl: GROUP_MEETING.channelUrl,
    self: ME
  };
  const participants = [
    { pubkey: MEMBER },
    { pubkey: OUTSIDER },
    { pubkey: OUTSIDER },
    { pubkey: ME },
    { name: 'Oma Erna' },
    { pubkey: 'not-a-key' }
  ];

  it('DMs each invited pubkey once, the guest link only to non-members', async () => {
    const result = await sendMeetingInvites({
      ...base,
      participants,
      memberPubkeys: [ME, MEMBER],
      guestUrl: GUEST_URL
    });
    expect(sendWrappedDm).toHaveBeenCalledTimes(2);
    const byRecipient = Object.fromEntries(sendWrappedDm.mock.calls.map(([pk, t]) => [pk, t]));
    expect(byRecipient[MEMBER]).not.toContain(GUEST_URL);
    expect(byRecipient[OUTSIDER]).toContain(GUEST_URL);
    expect(result).toEqual({ sent: 2, failed: [] });
  });

  it('includes the guest link for everyone when the roster is unknown', async () => {
    await sendMeetingInvites({ ...base, participants, guestUrl: GUEST_URL });
    for (const [, text] of sendWrappedDm.mock.calls) expect(text).toContain(GUEST_URL);
  });

  it('never sends a guest link when there is none', async () => {
    await sendMeetingInvites({ ...base, participants, memberPubkeys: [ME] });
    for (const [, text] of sendWrappedDm.mock.calls) expect(text).not.toContain('/call/');
  });

  it('collects per-invitee failures instead of throwing', async () => {
    sendWrappedDm.mockImplementation(async (pk) => {
      if (pk === OUTSIDER) throw new Error('no relays');
    });
    const result = await sendMeetingInvites({
      ...base,
      participants,
      memberPubkeys: [ME, MEMBER],
      guestUrl: GUEST_URL
    });
    expect(result).toEqual({ sent: 1, failed: [OUTSIDER] });
  });
});
