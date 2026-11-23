// "My calls" on the dashboard: which of my channels have a call running, and
// which meetings are scheduled in them. Pure; the relay reads live in
// my-calls.svelte.js.
import { channelKey } from './community-pointer.js';
import { isMeetingForGroup, meetingCoordinate, meetingTimes, meetingTitle } from './meetings.js';

/**
 * @typedef {{id: string, relay: string}} Pointer
 * @typedef {{pointer: Pointer, participants: string[]}} RunningCall
 * @typedef {{event: any, pointer: Pointer, title: string, start: number, end: number, started: boolean}} UpcomingMeeting
 */

/**
 * Channels with at least one person in the call, fullest first.
 * @param {Pointer[]} pointers my channels
 * @param {Record<string, string[]>} participantsByKey channelKey → pubkeys (relay-signed kind 39004)
 * @returns {RunningCall[]}
 */
export function runningCalls(pointers, participantsByKey) {
  return pointers
    .map((pointer) => ({
      pointer,
      participants: participantsByKey[channelKey(pointer) ?? ''] ?? []
    }))
    .filter((row) => row.participants.length > 0)
    .sort((a, b) => b.participants.length - a.participants.length);
}

/**
 * The meetings of my channels that have not ended, earliest first.
 *
 * A meeting is replaceable (kind 31923): the newest version per coordinate
 * counts, and a kind 5 of the same author that names the coordinate (or that
 * version's id) at or after it removes the meeting.
 *
 * @param {any[]} events kind 31923 and kind 5 events from the channels' relays
 * @param {Pointer[]} pointers my channels
 * @param {number} nowS
 * @param {number} [limit]
 * @returns {UpcomingMeeting[]}
 */
export function upcomingMeetings(events, pointers, nowS, limit = 5) {
  /** @type {Map<string, any>} */
  const newest = new Map();
  for (const event of events) {
    if (event?.kind !== 31923) continue;
    const key = meetingCoordinate(event);
    const have = newest.get(key);
    if (!have || event.created_at > have.created_at) newest.set(key, event);
  }
  for (const del of events) {
    if (del?.kind !== 5) continue;
    for (const tag of del.tags ?? []) {
      const target =
        tag[0] === 'a'
          ? newest.get(tag[1])
          : tag[0] === 'e'
            ? [...newest.values()].find((e) => e.id === tag[1])
            : null;
      if (target && target.pubkey === del.pubkey && del.created_at >= target.created_at)
        newest.delete(meetingCoordinate(target));
    }
  }
  /** @type {UpcomingMeeting[]} */
  const out = [];
  for (const event of newest.values()) {
    const pointer = pointers.find((p) => isMeetingForGroup(event, p.id));
    const times = meetingTimes(event);
    if (!pointer || !times || times.end <= nowS) continue;
    out.push({
      event,
      pointer,
      title: meetingTitle(event),
      ...times,
      started: times.start <= nowS
    });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, limit);
}
