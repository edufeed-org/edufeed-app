// Editing a scheduled meeting in a NIP-29 channel: the "Termin bearbeiten"
// dialog's submit path (CalendarEventModal in group-meeting EDIT mode).
//
// The meeting is a replaceable NIP-52 event, so an edit re-publishes the
// SAME coordinate (kind 31923, same d-tag, exactly one `["h", groupId]`)
// with a newer created_at — to the channel's group relay ONLY, never the
// outbox model or the calendar relays (a private channel's meeting must not
// leave its relay; the generic calendar edit path is never used here).
//
// A reschedule keeps an already-shared guest link working: the relay freezes
// the pass window at mint time (see renewMeetingLink in call-passes.js), so
// the pass is minted again with the same code and the new window. It also
// posts a "Termin verschoben" notice into the channel (kind 9) and DMs the
// invitees (notifyMeetingChange).
//
// Plain module (no runes): called from the modal and tested in node.
import { publishToGroupRelay } from './group-management.js';
import { createMeetingLink, renewMeetingLink, revokeCallPass } from './call-passes.js';
import { buildGroupMessageTemplate } from './groups.js';
import {
  MEETING_KIND,
  MEETING_DEFAULT_DURATION_S,
  buildMeetingTags,
  meetingCoordinate,
  meetingTimes,
  isMeetingForGroup,
  canHaveGuestLink
} from './meetings.js';
import { meetingInviteText } from './schedule-meeting.js';
import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { formatTimestamp, formatTimeOfDay, formatTimeZoneName } from '$lib/helpers/dates.js';
import * as m from '$lib/paraglide/messages';

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/**
 * The dialog's channel context, plus — for an edit — the meeting's current
 * guest pass (kind 9025, mine) when it has one.
 * @typedef {import('./schedule-meeting.js').GroupMeeting & {guestPass?: any | null}} EditableGroupMeeting
 */

/** @param {string[][]} tags @param {string} name */
function tagNumber(tags, name) {
  const n = Number(tags.find((t) => t[0] === name)?.[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef {'off' | 'kept' | 'renewed' | 'created' | 'revoked' | 'too_far' | 'failed'} GuestStatus
 * - `off`: no guest link before, none wanted
 * - `kept`: the existing link is untouched (time unchanged)
 * - `renewed`: the existing URL keeps working with the new window
 * - `created`: a NEW URL exists (switched on, or the old code was unreadable)
 * - `revoked`: the link was switched off
 * - `too_far`: guests wanted, but the meeting ends beyond the relay's 60-day pass limit
 * - `failed`: the meeting was saved, but the link step failed
 */

/**
 * Re-publish the meeting (same d-tag) to the group relay, then settle its
 * guest link and, on a reschedule, post the channel notice. A failed guest
 * link or notice never undoes the edit; a rejected meeting throws.
 *
 * @param {{relayConn: any, formData: import('../types/calendar.js').EventFormData,
 *   groupMeeting: EditableGroupMeeting, existing: any,
 *   guestPass?: any | null, user: {pubkey: string, signer: any}, origin: string,
 *   allowGuests: boolean, nowS?: number}} p
 * @returns {Promise<{event: any, start: number, end: number,
 *   previous: {start: number, end: number}, rescheduled: boolean,
 *   guestUrl: string | null, guestStatus: GuestStatus,
 *   noticeStatus: 'none' | 'sent' | 'failed'}>}
 */
export async function updateGroupMeeting({
  relayConn,
  formData,
  groupMeeting,
  existing,
  guestPass = null,
  user,
  origin,
  allowGuests,
  nowS = Math.floor(Date.now() / 1000)
}) {
  const { pointer, channelUrl } = groupMeeting;
  if (existing?.pubkey !== user.pubkey) throw new Error('only the author can edit this meeting');
  if (!isMeetingForGroup(existing, pointer.id)) throw new Error('not a meeting of this channel');
  const dTag = existing.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (!dTag) throw new Error('meeting without d tag');
  const previous = meetingTimes(existing);
  if (!previous) throw new Error('meeting without start');

  const tags = buildMeetingTags(
    { ...formData, eventType: 'time', isAllDay: false },
    { groupId: pointer.id, dTag, channelUrl }
  );
  const template = {
    kind: MEETING_KIND,
    content: formData.summary?.trim() || '',
    // Replaceable: relays keep the newest created_at, so always stamp past
    // the stored event, even on a device whose clock is behind.
    created_at: Math.max(nowS, (existing.created_at ?? 0) + 1),
    tags
  };
  const event = await publishToGroupRelay(relayConn, template, user);
  eventStore.add(event);

  const start = /** @type {number} */ (tagNumber(tags, 'start'));
  const end = tagNumber(tags, 'end') ?? start + MEETING_DEFAULT_DURATION_S;
  const rescheduled = start !== previous.start || end !== previous.end;
  const title = formData.title.trim();

  const { guestUrl, guestStatus } = await settleGuestLink({
    relayConn,
    pointer,
    user,
    origin,
    allowGuests,
    guestPass,
    rescheduled,
    meeting: { start, end, coordinate: meetingCoordinate(event), title },
    nowS
  });

  /** @type {'none' | 'sent' | 'failed'} */
  let noticeStatus = 'none';
  if (rescheduled) {
    try {
      const notice = await publishToGroupRelay(
        relayConn,
        buildGroupMessageTemplate(
          pointer.id,
          meetingRescheduledText({ title, start, previousStart: previous.start })
        ),
        user
      );
      eventStore.add(notice);
      noticeStatus = 'sent';
    } catch (err) {
      console.warn('meeting: reschedule notice failed', err);
      noticeStatus = 'failed';
    }
  }

  return { event, start, end, previous, rescheduled, guestUrl, guestStatus, noticeStatus };
}

/**
 * The guest link after an edit: renewed (same URL) when the time moved,
 * untouched when it did not, minted when switched on, revoked when switched
 * off — and revoked when the meeting moved beyond the relay's pass limit,
 * since a pass windowed around the old time would otherwise linger.
 * Only a pass of mine counts; someone else's is never touched.
 *
 * @param {{relayConn: any, pointer: {id: string, relay: string},
 *   user: {pubkey: string, signer: any}, origin: string, allowGuests: boolean,
 *   guestPass: any | null, rescheduled: boolean,
 *   meeting: {start: number, end: number, coordinate: string, title: string},
 *   nowS: number}} p
 * @returns {Promise<{guestUrl: string | null, guestStatus: GuestStatus}>}
 */
async function settleGuestLink({
  relayConn,
  pointer,
  user,
  origin,
  allowGuests,
  guestPass,
  rescheduled,
  meeting,
  nowS
}) {
  const mine = guestPass && guestPass.pubkey === user.pubkey ? guestPass : null;
  try {
    if (!allowGuests) {
      if (!mine) return { guestUrl: null, guestStatus: 'off' };
      eventStore.add(await revokeCallPass(relayConn, mine, user));
      return { guestUrl: null, guestStatus: 'revoked' };
    }
    if (!canHaveGuestLink({ end: meeting.end }, nowS)) {
      if (mine) eventStore.add(await revokeCallPass(relayConn, mine, user));
      return { guestUrl: null, guestStatus: 'too_far' };
    }
    if (mine) {
      if (!rescheduled) return { guestUrl: null, guestStatus: 'kept' };
      const link = await renewMeetingLink(relayConn, pointer, user, origin, mine, meeting);
      eventStore.add(link.event);
      if (link.revoked) eventStore.add(link.revoked);
      return { guestUrl: link.url, guestStatus: link.sameCode ? 'renewed' : 'created' };
    }
    const link = await createMeetingLink(relayConn, pointer, user, origin, meeting);
    eventStore.add(link.event);
    return { guestUrl: link.url, guestStatus: 'created' };
  } catch (err) {
    console.warn('meeting: guest link update failed', err);
    return { guestUrl: null, guestStatus: 'failed' };
  }
}

/** @param {number} s */
const dateOf = (s) => formatTimestamp(s, { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * The channel notice (kind 9) for a moved meeting: title, the new
 * DD.MM.YYYY HH:MM with the time-zone name, and the previous date/time.
 * @param {{title: string, start: number, previousStart: number}} p
 */
export function meetingRescheduledText({ title, start, previousStart }) {
  return m.meeting_rescheduled_chat({
    title,
    date: dateOf(start),
    time: formatTimeOfDay(start),
    zone: formatTimeZoneName(start),
    oldDate: dateOf(previousStart),
    oldTime: formatTimeOfDay(previousStart)
  });
}

/**
 * The reschedule DM: like the channel notice, plus the channel and its link
 * — and the guest link when one is given (only for invitees off the roster).
 * @param {{title: string, start: number, previousStart: number, channelName: string,
 *   channelUrl: string, guestUrl?: string | null}} p
 */
export function meetingRescheduledDmText({
  title,
  start,
  previousStart,
  channelName,
  channelUrl,
  guestUrl
}) {
  const text = m.meeting_rescheduled_dm({
    title,
    date: dateOf(start),
    time: formatTimeOfDay(start),
    zone: formatTimeZoneName(start),
    oldDate: dateOf(previousStart),
    oldTime: formatTimeOfDay(previousStart),
    channel: channelName,
    channelUrl
  });
  return guestUrl ? `${text}\n${m.meeting_invite_dm_guest({ guestUrl })}` : text;
}

/**
 * NIP-17 DMs after an edit, once per invited pubkey, never to the
 * organiser: invitees who are new to the meeting get the invitation,
 * everyone already invited gets the "moved" notice — only when the time
 * changed. The guest link goes only to invitees not on the channel roster
 * (to everyone when no roster is known). Per-invitee failures are
 * collected, never thrown.
 *
 * @param {{participants?: Array<{pubkey?: string, name?: string}>,
 *   previousParticipants?: string[], self: string, memberPubkeys?: string[] | null,
 *   guestUrl?: string | null, title: string, start: number, previousStart: number,
 *   rescheduled: boolean, channelName: string, channelUrl: string}} p
 * @returns {Promise<{sent: number, failed: string[]}>}
 */
export async function notifyMeetingChange({
  participants,
  previousParticipants,
  self,
  memberPubkeys,
  guestUrl,
  title,
  start,
  previousStart,
  rescheduled,
  channelName,
  channelUrl
}) {
  const roster = Array.isArray(memberPubkeys) ? new Set(memberPubkeys) : null;
  const before = new Set(previousParticipants || []);
  /** @type {string[]} */
  const recipients = [];
  for (const p of participants || []) {
    const pk = p?.pubkey;
    if (typeof pk !== 'string' || !HEX_PUBKEY_RE.test(pk) || pk === self) continue;
    if (recipients.includes(pk)) continue;
    if (before.has(pk) && !rescheduled) continue;
    recipients.push(pk);
  }
  const results = await Promise.allSettled(
    recipients.map((pubkey) => {
      const link = roster && roster.has(pubkey) ? null : guestUrl;
      const common = { title, start, channelName, channelUrl, guestUrl: link };
      const text = before.has(pubkey)
        ? meetingRescheduledDmText({ ...common, previousStart })
        : meetingInviteText(common);
      return sendWrappedDm(pubkey, text);
    })
  );
  const failed = recipients.filter((_, i) => results[i].status === 'rejected');
  return { sent: recipients.length - failed.length, failed };
}
