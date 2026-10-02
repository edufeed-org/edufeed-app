/**
 * A calendar event h-tagged with a channel id (not a 64-hex community
 * pubkey) is a channel meeting: it lives on its group relay only and must
 * stay out of every generic calendar surface, share path and the IDB cache.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { isChannelMeeting, withoutChannelMeetings } from '$lib/helpers/calendar-timing.js';
import { isChannelMeeting as fromMeetings } from '$lib/groups/meetings.js';

const COMMUNITY = 'c'.repeat(64);
/** @param {number} kind @param {string[][]} tags */
const ev = (kind, tags) => ({ id: `${kind}-${tags.length}`, kind, pubkey: 'a'.repeat(64), tags });

describe('isChannelMeeting', () => {
  it('is true for a 31923/31922 with a channel-id h tag', () => {
    expect(isChannelMeeting(ev(31923, [['h', '4c9b50c8c413f15e']]))).toBe(true);
    expect(isChannelMeeting(ev(31922, [['h', 'f47ac10b-58cc-4372-a567-0e02b2c3d479']]))).toBe(true);
  });

  it('is true when a channel id rides along with a community pubkey', () => {
    expect(
      isChannelMeeting(
        ev(31923, [
          ['h', COMMUNITY],
          ['h', 'g1']
        ])
      )
    ).toBe(true);
  });

  it('is false for community-targeted and untargeted calendar events', () => {
    expect(isChannelMeeting(ev(31923, [['h', COMMUNITY]]))).toBe(false);
    expect(isChannelMeeting(ev(31922, []))).toBe(false);
  });

  it('is false for other kinds (a chat message in a channel is not a meeting)', () => {
    expect(isChannelMeeting(ev(9, [['h', 'g1']]))).toBe(false);
    expect(isChannelMeeting(null)).toBe(false);
  });

  it('is re-exported from the meetings module', () => {
    expect(fromMeetings).toBe(isChannelMeeting);
  });
});

describe('withoutChannelMeetings', () => {
  it('drops channel meetings and keeps everything else in order', () => {
    const a = ev(31923, [['h', COMMUNITY]]);
    const meeting = ev(31923, [
      ['h', 'g1'],
      ['d', 'm']
    ]);
    const note = ev(1, []);
    expect(withoutChannelMeetings([a, meeting, note])).toEqual([a, note]);
  });

  it('accepts transformed CalendarEvents through originalEvent', () => {
    const meeting = { originalEvent: ev(31923, [['h', 'g1']]) };
    const other = { originalEvent: ev(31923, []) };
    expect(withoutChannelMeetings([meeting, other])).toEqual([other]);
  });
});
