// Channel calendars on the community calendar (communikey-groups.md,
// "Channel calendars").
//
// A channel meeting is a kind-31923 event h-tagged with ONE channel id that
// lives only on that channel's group relay (see meetings.js). Every generic
// calendar surface drops it (isChannelMeeting) so a private meeting is never
// republished, shared or cached. The community calendar is the one place that
// adds them back — read-only, on purpose: each meeting carries its channel
// (`channelMeeting`) so the views render "in #channel" and link to the channel
// instead of a shareable /calendar/event page, RSVP or reactions.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { channelKey } from './community-pointer.js';
import { isMeetingForGroup } from './meetings.js';
import { validateCalendarEvent } from '$lib/helpers/eventValidation.js';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';

/**
 * @typedef {{id: string, relay: string, name?: string}} ChannelCalendarPointer
 * @typedef {{id: string, name: string, href: string}} ChannelMeetingRef
 */

/**
 * Every channel whose calendar the community calendar reads: the root
 * membership group (shown as "General"), the channels discovered from the
 * relay subtree, then any legacy kind-10222 `group` pointers — once each, by
 * channel identity (id @ normalised relay).
 *
 * @param {{
 *   legacy?: Array<{id: string, relay: string, name?: string}>,
 *   rootChannel?: {id: string, relay: string, name?: string} | null,
 *   channels?: Array<{id: string, relay: string, name?: string}>,
 *   generalName?: string
 * }} sources
 * @returns {ChannelCalendarPointer[]}
 */
export function channelCalendarPointers({ legacy = [], rootChannel, channels = [], generalName }) {
  /** @type {ChannelCalendarPointer[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {{id: string, relay: string}} pointer @param {string | undefined} name */
  const add = (pointer, name) => {
    const key = channelKey(pointer);
    if (!key || seen.has(key)) return;
    seen.add(key);
    /** @type {ChannelCalendarPointer} */
    const row = { id: pointer.id, relay: pointer.relay };
    if (name) row.name = name;
    out.push(row);
  };
  if (rootChannel) add(rootChannel, generalName);
  for (const channel of channels) add(channel, channel.name);
  for (const pointer of legacy) add(pointer, pointer.name);
  return out;
}

/**
 * One request per group relay: the channel ids that live there.
 * @param {Array<{id: string, relay: string}>} pointers
 * @returns {Array<{relay: string, ids: string[]}>}
 */
export function pointersByRelay(pointers) {
  /** @type {Map<string, {relay: string, ids: string[]}>} */
  const byRelay = new Map();
  for (const pointer of pointers) {
    if (!channelKey(pointer)) continue;
    const key = normalizeURL(pointer.relay);
    let group = byRelay.get(key);
    if (!group) {
      group = { relay: pointer.relay, ids: [] };
      byRelay.set(key, group);
    }
    if (!group.ids.includes(pointer.id)) group.ids.push(pointer.id);
  }
  return [...byRelay.values()];
}

/**
 * The community channel route a meeting links to (PrivateChannelsView opens
 * the channel from `?channel=`).
 * @param {string} communityNpub
 * @param {string} channelId
 */
export function channelMeetingHref(communityNpub, channelId) {
  return `/c/${communityNpub}?view=channels&channel=${encodeURIComponent(channelId)}`;
}

/**
 * Raw kind-31923 events → CalendarEvents for the community calendar, keeping
 * only valid meetings of one of the community's channels (exactly one `h`,
 * naming that channel). Each carries `channelMeeting` with the channel's
 * name and link. Meetings a moderator removed (kind-9005 `e` tags, as
 * GroupChat's deletedMessageIds reads them — the group relay accepts 9005
 * from moderators only) are left out; author kind-5s already leave through
 * the eventStore's DeleteManager.
 *
 * @param {any[]} rawEvents
 * @param {ChannelCalendarPointer[]} pointers
 * @param {{communityNpub: string, deletions?: any[]}} opts
 * @returns {Array<import('$lib/types/calendar.js').CalendarEvent & {channelMeeting: ChannelMeetingRef}>}
 */
export function toChannelMeetings(rawEvents, pointers, { communityNpub, deletions = [] }) {
  const deleted = new Set(
    deletions.flatMap((deletion) =>
      (deletion?.tags ?? [])
        .filter((/** @type {string[]} */ t) => t[0] === 'e' && t[1])
        .map((/** @type {string[]} */ t) => t[1])
    )
  );
  const out = [];
  for (const event of rawEvents) {
    if (deleted.has(event?.id)) continue;
    const pointer = pointers.find((p) => isMeetingForGroup(event, p.id));
    if (!pointer || !validateCalendarEvent(event)) continue;
    out.push({
      ...getCalendarEventMetadata(event),
      channelMeeting: {
        id: pointer.id,
        name: pointer.name || pointer.id,
        href: channelMeetingHref(communityNpub, pointer.id)
      }
    });
  }
  return out;
}

/** @param {any} item */
function coordinateOf(item) {
  const raw = item?.originalEvent ?? item;
  const d = raw?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '';
  return `${raw?.kind}:${raw?.pubkey}:${d}`;
}

/**
 * The community's own events plus its channels' meetings, one per coordinate
 * (the community's own event wins a clash).
 * @template T
 * @param {T[]} communityEvents
 * @param {T[]} meetings
 * @returns {T[]}
 */
export function mergeChannelMeetings(communityEvents, meetings) {
  if (meetings.length === 0) return communityEvents;
  const seen = new Set(communityEvents.map(coordinateOf));
  const out = [...communityEvents];
  for (const item of meetings) {
    const key = coordinateOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
