// Scheduling a meeting in a NIP-29 channel: the "Termin planen" dialog's
// submit path (CalendarEventModal in group-meeting mode).
//
// The meeting (kind 31923, one `["h", groupId]`) goes to the channel's group
// relay ONLY — never the outbox model or the calendar relays: a private
// channel's meeting must not leave its relay. A guest link is a call pass
// minted next to it (createMeetingLink); its code lives only in the link and
// in the self-encrypted pass content, never in the event and never in a DM to
// a channel member.
//
// Plain module (no runes): called from the modal and tested in node.
import { publishToGroupRelay } from './group-management.js';
import { createMeetingLink } from './call-passes.js';
import { MEETING_KIND, buildMeetingTags, meetingCoordinate, canHaveGuestLink } from './meetings.js';
import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { formatTimestamp, formatTimeOfDay } from '$lib/helpers/dates.js';
import * as m from '$lib/paraglide/messages';

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
/** A meeting without an end lasts an hour (for the guest window). */
const DEFAULT_DURATION_S = 3600;

/**
 * @typedef {{pointer: {id: string, relay: string}, channelName: string,
 *   channelUrl: string, memberPubkeys?: string[]}} GroupMeeting
 */

/** @param {string[][]} tags @param {string} name */
function tagNumber(tags, name) {
  const n = Number(tags.find((t) => t[0] === name)?.[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sign and publish the meeting to the group relay, then (when guests are
 * allowed and the relay's 60-day pass limit permits) mint its guest link.
 * A failed guest link never undoes the meeting; a rejected meeting throws.
 *
 * @param {{relayConn: any, formData: import('../types/calendar.js').EventFormData,
 *   groupMeeting: GroupMeeting, user: {pubkey: string, signer: any}, origin: string,
 *   allowGuests: boolean, nowS?: number}} p
 * @returns {Promise<{event: any, start: number, end: number, guestUrl: string | null,
 *   guestStatus: 'off' | 'created' | 'too_far' | 'failed'}>}
 */
export async function scheduleGroupMeeting({
  relayConn,
  formData,
  groupMeeting,
  user,
  origin,
  allowGuests,
  nowS = Math.floor(Date.now() / 1000)
}) {
  const { pointer, channelUrl } = groupMeeting;
  const dTag = `meeting-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const tags = buildMeetingTags(
    { ...formData, eventType: 'time', isAllDay: false },
    { groupId: pointer.id, dTag, channelUrl }
  );
  const template = {
    kind: MEETING_KIND,
    content: formData.summary?.trim() || '',
    created_at: nowS,
    tags
  };
  const event = await publishToGroupRelay(relayConn, template, user);
  eventStore.add(event);

  const start = /** @type {number} */ (tagNumber(tags, 'start'));
  const end = tagNumber(tags, 'end') ?? start + DEFAULT_DURATION_S;

  /** @type {'off' | 'created' | 'too_far' | 'failed'} */
  let guestStatus = 'off';
  let guestUrl = null;
  if (allowGuests) {
    if (!canHaveGuestLink({ end }, nowS)) {
      guestStatus = 'too_far';
    } else {
      try {
        const link = await createMeetingLink(relayConn, pointer, user, origin, {
          start,
          end,
          coordinate: meetingCoordinate(event),
          title: formData.title.trim()
        });
        guestUrl = link.url;
        guestStatus = 'created';
      } catch (err) {
        console.warn('meeting: guest link failed', err);
        guestStatus = 'failed';
      }
    }
  }
  return { event, start, end, guestUrl, guestStatus };
}

/**
 * The invitation DM: title, DD.MM.YYYY, HH:MM, the channel and its link —
 * plus the guest link when one is given (only for invitees off the roster).
 * @param {{title: string, start: number, channelName: string, channelUrl: string,
 *   guestUrl?: string | null}} p
 */
export function meetingInviteText({ title, start, channelName, channelUrl, guestUrl }) {
  const text = m.meeting_invite_dm({
    title,
    date: formatTimestamp(start, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: formatTimeOfDay(start),
    channel: channelName,
    channelUrl
  });
  return guestUrl ? `${text}\n${m.meeting_invite_dm_guest({ guestUrl })}` : text;
}

/**
 * NIP-17 invitations to every NIP-52 participant with a pubkey (name-only
 * participants have no address), once each, never to the organiser. The
 * guest link goes only to invitees not on the channel roster; with no roster
 * known, to everyone. Per-invitee failures are collected, never thrown.
 *
 * @param {{participants?: Array<{pubkey?: string, name?: string}>, self: string,
 *   memberPubkeys?: string[] | null, guestUrl?: string | null, title: string,
 *   start: number, channelName: string, channelUrl: string}} p
 * @returns {Promise<{sent: number, failed: string[]}>}
 */
export async function sendMeetingInvites({
  participants,
  self,
  memberPubkeys,
  guestUrl,
  title,
  start,
  channelName,
  channelUrl
}) {
  const roster = Array.isArray(memberPubkeys) ? new Set(memberPubkeys) : null;
  /** @type {string[]} */
  const recipients = [];
  for (const p of participants || []) {
    const pk = p?.pubkey;
    if (typeof pk === 'string' && HEX_PUBKEY_RE.test(pk) && pk !== self && !recipients.includes(pk))
      recipients.push(pk);
  }
  const results = await Promise.allSettled(
    recipients.map((pubkey) =>
      sendWrappedDm(
        pubkey,
        meetingInviteText({
          title,
          start,
          channelName,
          channelUrl,
          guestUrl: roster && roster.has(pubkey) ? null : guestUrl
        })
      )
    )
  );
  const failed = recipients.filter((_, i) => results[i].status === 'rejected');
  return { sent: recipients.length - failed.length, failed };
}
