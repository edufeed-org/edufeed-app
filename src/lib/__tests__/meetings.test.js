/**
 * Pure helper tests for scheduled meetings in NIP-29 channels (kind 31923,
 * exactly one group-id `h` tag, published only to the channel's group
 * relay — see docs/superpowers/sdd/2026-10-02-scheduled-meetings).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  MEETING_KIND,
  GUEST_EARLY_S,
  GUEST_LATE_S,
  PASS_MAX_LIFETIME_S,
  buildMeetingTags,
  meetingCoordinate,
  guestWindow,
  canHaveGuestLink,
  meetingPhase,
  isMeetingForGroup,
  buildMeetingIcs,
  icsFileName,
  findMeetingPass,
  meetingTimes,
  nextBarMeeting,
  canJoinMeetingNow,
  meetingTitle,
  defaultMeetingSlot,
  nextMeetingBoundary
} from '../groups/meetings.js';

/** @param {string[][]} tags @param {string} name @returns {string[][]} */
function findTags(tags, name) {
  return tags.filter((t) => t[0] === name);
}

/** @param {string[][]} tags @param {string} name @returns {string | undefined} */
function findTagValue(tags, name) {
  return tags.find((t) => t[0] === name)?.[1];
}

describe('constants', () => {
  it('match the NIP-29 call-pass / NIP-52 conventions', () => {
    expect(MEETING_KIND).toBe(31923);
    expect(GUEST_EARLY_S).toBe(900);
    expect(GUEST_LATE_S).toBe(1800);
    expect(PASS_MAX_LIFETIME_S).toBe(60 * 86400);
  });
});

describe('buildMeetingTags', () => {
  /** @type {any} */
  const formData = {
    title: 'Standup',
    summary: 'Daily sync',
    image: '',
    startDate: '2026-10-10',
    startTime: '09:00',
    endDate: '2026-10-10',
    endTime: '09:30',
    startTimezone: 'Europe/Berlin',
    endTimezone: 'Europe/Berlin',
    location: 'This should be replaced',
    isAllDay: false,
    eventType: 'time',
    references: []
  };

  it('has exactly one h tag (the group id) and no community h tag', () => {
    const tags = buildMeetingTags(formData, {
      groupId: 'group-123',
      dTag: 'meeting-abc',
      channelUrl: 'https://edufeed.app/c/npub1xyz/channel-1'
    });

    const hTags = findTags(tags, 'h');
    expect(hTags).toHaveLength(1);
    expect(hTags[0]).toEqual(['h', 'group-123']);
  });

  it('replaces the form location with the channel URL', () => {
    const tags = buildMeetingTags(formData, {
      groupId: 'group-123',
      dTag: 'meeting-abc',
      channelUrl: 'https://edufeed.app/c/npub1xyz/channel-1'
    });

    const locationTags = findTags(tags, 'location');
    expect(locationTags).toHaveLength(1);
    expect(findTagValue(tags, 'location')).toBe('https://edufeed.app/c/npub1xyz/channel-1');
  });

  it('keeps the d-tag, title and NIP-52 timing tags', () => {
    const tags = buildMeetingTags(formData, {
      groupId: 'group-123',
      dTag: 'meeting-abc',
      channelUrl: 'https://edufeed.app/c/npub1xyz/channel-1'
    });

    expect(findTagValue(tags, 'd')).toBe('meeting-abc');
    expect(findTagValue(tags, 'title')).toBe('Standup');
    expect(findTagValue(tags, 'start')).toBeTruthy();
    expect(findTagValue(tags, 'end')).toBeTruthy();
    expect(findTagValue(tags, 'start_tzid')).toBe('Europe/Berlin');
  });
});

describe('meetingCoordinate', () => {
  it('builds kind:pubkey:d', () => {
    const event = {
      kind: 31923,
      pubkey: 'abc123',
      tags: [['d', 'meeting-1']]
    };
    expect(meetingCoordinate(event)).toBe('31923:abc123:meeting-1');
  });
});

describe('guestWindow', () => {
  it('opens 15 min before start and closes 30 min after end', () => {
    const start = 1_000_000;
    const end = 1_001_000;
    expect(guestWindow({ start, end })).toEqual({
      notBefore: start - 900,
      expiration: end + 1800
    });
  });
});

describe('canHaveGuestLink', () => {
  it('is true exactly at the 60-day boundary', () => {
    const nowS = 1_000_000;
    const end = nowS + PASS_MAX_LIFETIME_S - GUEST_LATE_S; // end + 1800 === now + 60d
    expect(canHaveGuestLink({ end }, nowS)).toBe(true);
  });

  it('is false just past the 60-day boundary', () => {
    const nowS = 1_000_000;
    const end = nowS + PASS_MAX_LIFETIME_S - GUEST_LATE_S + 1;
    expect(canHaveGuestLink({ end }, nowS)).toBe(false);
  });

  it('is true for a meeting happening soon', () => {
    const nowS = 1_000_000;
    expect(canHaveGuestLink({ end: nowS + 3600 }, nowS)).toBe(true);
  });
});

describe('meetingPhase', () => {
  const start = 1_000_000;
  const end = 1_003_600; // +1h

  it('is upcoming before the guest-early window opens', () => {
    expect(meetingPhase({ start, end }, start - GUEST_EARLY_S - 1)).toBe('upcoming');
  });

  it('is joinable exactly at start - 900', () => {
    expect(meetingPhase({ start, end }, start - GUEST_EARLY_S)).toBe('joinable');
  });

  it('is joinable right before start', () => {
    expect(meetingPhase({ start, end }, start - 1)).toBe('joinable');
  });

  it('is running exactly at start', () => {
    expect(meetingPhase({ start, end }, start)).toBe('running');
  });

  it('is running right before end', () => {
    expect(meetingPhase({ start, end }, end - 1)).toBe('running');
  });

  it('is past exactly at end', () => {
    expect(meetingPhase({ start, end }, end)).toBe('past');
  });

  it('is past well after end', () => {
    expect(meetingPhase({ start, end }, end + 10_000)).toBe('past');
  });
});

describe('isMeetingForGroup', () => {
  it('is true for a kind-31923 event with exactly one matching h tag', () => {
    const event = { kind: 31923, tags: [['h', 'group-1']] };
    expect(isMeetingForGroup(event, 'group-1')).toBe(true);
  });

  it('is false when the h tag belongs to a different group', () => {
    const event = { kind: 31923, tags: [['h', 'group-2']] };
    expect(isMeetingForGroup(event, 'group-1')).toBe(false);
  });

  it('is false for a non-meeting kind', () => {
    const event = { kind: 1, tags: [['h', 'group-1']] };
    expect(isMeetingForGroup(event, 'group-1')).toBe(false);
  });

  it('is false when there are zero or more than one h tags', () => {
    expect(isMeetingForGroup({ kind: 31923, tags: [] }, 'group-1')).toBe(false);
    expect(
      isMeetingForGroup(
        {
          kind: 31923,
          tags: [
            ['h', 'group-1'],
            ['h', 'group-2']
          ]
        },
        'group-1'
      )
    ).toBe(false);
  });
});

describe('buildMeetingIcs', () => {
  it('writes UTC DTSTART/DTEND with CRLF line endings', () => {
    const ics = buildMeetingIcs({
      title: 'Standup',
      start: 1_760_000_000,
      end: 1_760_003_600,
      description: 'Daily sync',
      url: 'https://edufeed.app/c/npub1xyz/channel-1'
    });

    expect(ics).toContain('\r\n');
    expect(ics.split('\r\n').some((l) => /^DTSTART:\d{8}T\d{6}Z$/.test(l))).toBe(true);
    expect(ics.split('\r\n').some((l) => /^DTEND:\d{8}T\d{6}Z$/.test(l))).toBe(true);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('escapes commas, semicolons and newlines in text fields', () => {
    const ics = buildMeetingIcs({
      title: 'Team; sync, weekly',
      start: 1_760_000_000,
      end: 1_760_003_600,
      description: 'Line one\nLine two, with; punctuation',
      url: 'https://edufeed.app/c/npub1xyz/channel-1'
    });

    expect(ics).toContain('SUMMARY:Team\\; sync\\, weekly');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\, with\\; punctuation');
  });

  it('includes the URL field', () => {
    const ics = buildMeetingIcs({
      title: 'Standup',
      start: 1_760_000_000,
      end: 1_760_003_600,
      url: 'https://edufeed.app/c/npub1xyz/channel-1'
    });
    expect(ics).toContain('URL:https://edufeed.app/c/npub1xyz/channel-1');
  });

  it('includes DTSTAMP at the given nowS, in UTC', () => {
    const nowS = 1_760_000_500;
    const expectedStamp =
      new Date(nowS * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const ics = buildMeetingIcs({
      title: 'Standup',
      start: 1_760_000_000,
      end: 1_760_003_600,
      url: 'https://edufeed.app/c/npub1xyz/channel-1',
      nowS
    });

    expect(ics).toContain(`DTSTAMP:${expectedStamp}`);
  });

  it('uses a stable UID derived from the given coordinate, independent of start/end', () => {
    const uid = '31923:abc123:meeting-1';
    const a = buildMeetingIcs({
      title: 'Standup',
      start: 1_760_000_000,
      end: 1_760_003_600,
      url: 'https://edufeed.app/c/x',
      uid,
      nowS: 500
    });
    const b = buildMeetingIcs({
      title: 'Standup (rescheduled)',
      start: 1_800_000_000,
      end: 1_800_003_600,
      url: 'https://edufeed.app/c/x',
      uid,
      nowS: 999
    });

    const uidLineOf = (/** @type {string} */ ics) =>
      ics.split('\r\n').find((l) => l.startsWith('UID:'));
    expect(uidLineOf(a)).toBe('UID:31923:abc123:meeting-1@edufeed');
    expect(uidLineOf(a)).toBe(uidLineOf(b));
  });

  it('falls back to a start/end derived UID when none is given', () => {
    const ics = buildMeetingIcs({
      title: 'Standup',
      start: 1000,
      end: 2000,
      url: 'https://edufeed.app/c/x',
      nowS: 500
    });
    expect(ics).toContain('UID:meeting-1000-2000@edufeed');
  });

  it('folds a long line with multi-byte characters without breaking any character', () => {
    // German umlauts (ä/ö/ü) are 2-byte UTF-8 sequences — a long run of them
    // forces a fold in the middle of the SUMMARY value.
    const title = 'Projektbesprechung ' + 'ä'.repeat(60);
    const ics = buildMeetingIcs({
      title,
      start: 1_760_000_000,
      end: 1_760_003_600,
      url: 'https://edufeed.app/c/x',
      nowS: 500
    });

    expect(ics).not.toContain('�'); // no mangled/replacement characters

    const physicalLines = ics.split('\r\n');
    const summaryStart = physicalLines.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(summaryStart).toBeGreaterThan(-1);

    let end = summaryStart + 1;
    let unfolded = physicalLines[summaryStart];
    while (end < physicalLines.length && physicalLines[end].startsWith(' ')) {
      unfolded += physicalLines[end].slice(1);
      end++;
    }
    // Folded into more than one physical line…
    expect(end - summaryStart).toBeGreaterThan(1);
    // …but reassembles to the exact, unescaped original (no special chars here).
    expect(unfolded).toBe(`SUMMARY:${title}`);

    // Every physical line respects the 75-octet limit.
    const encoder = new TextEncoder();
    for (let i = summaryStart; i < end; i++) {
      expect(encoder.encode(physicalLines[i]).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('icsFileName', () => {
  it('produces a safe .ics filename from the title', () => {
    expect(icsFileName('Team: Weekly / Sync?')).toMatch(/\.ics$/);
    expect(icsFileName('Team: Weekly / Sync?')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('falls back to a generic name for an empty title', () => {
    expect(icsFileName('')).toBe('meeting.ics');
    expect(icsFileName(undefined)).toBe('meeting.ics');
  });
});

describe('findMeetingPass', () => {
  const coordinate = '31923:abc:meeting-1';

  it('returns the newest pass whose a tag matches the coordinate', () => {
    const older = {
      id: 'pass-older',
      created_at: 100,
      tags: [['a', coordinate, 'wss://groups.example/']]
    };
    const newer = {
      id: 'pass-newer',
      created_at: 200,
      tags: [['a', coordinate, 'wss://groups.example/']]
    };
    const other = {
      id: 'pass-other',
      created_at: 300,
      tags: [['a', '31923:abc:some-other-meeting', 'wss://groups.example/']]
    };

    expect(findMeetingPass([older, newer, other], coordinate)).toBe(newer);
    expect(findMeetingPass([newer, older, other], coordinate)).toBe(newer);
  });

  it('returns null when no pass matches', () => {
    const other = {
      id: 'pass-other',
      created_at: 300,
      tags: [['a', '31923:abc:some-other-meeting', 'wss://groups.example/']]
    };
    expect(findMeetingPass([other], coordinate)).toBeNull();
    expect(findMeetingPass([], coordinate)).toBeNull();
  });
});

describe('meetingTimes', () => {
  it('reads start/end from the tags', () => {
    const event = {
      kind: 31923,
      tags: [
        ['start', '1000'],
        ['end', '4600']
      ]
    };
    expect(meetingTimes(event)).toEqual({ start: 1000, end: 4600 });
  });

  it('lasts an hour when the end is missing or not after the start', () => {
    expect(meetingTimes({ kind: 31923, tags: [['start', '1000']] })).toEqual({
      start: 1000,
      end: 4600
    });
    expect(
      meetingTimes({
        kind: 31923,
        tags: [
          ['start', '1000'],
          ['end', '900']
        ]
      })
    ).toEqual({
      start: 1000,
      end: 4600
    });
  });

  it('is null without a usable start', () => {
    expect(meetingTimes({ kind: 31923, tags: [] })).toBeNull();
    expect(meetingTimes({ kind: 31923, tags: [['start', 'soon']] })).toBeNull();
  });
});

describe('nextBarMeeting', () => {
  const now = 1_000_000;
  /** @param {string} id @param {number} start @param {number} [end] */
  const meeting = (id, start, end = start + 3600) => ({
    id,
    kind: 31923,
    tags: [
      ['d', id],
      ['start', String(start)],
      ['end', String(end)]
    ]
  });

  it('is null when nothing runs, opens or starts within 24 h', () => {
    expect(nextBarMeeting([], now)).toBeNull();
    expect(nextBarMeeting([meeting('far', now + 86400 + 60)], now)).toBeNull();
    expect(nextBarMeeting([meeting('past', now - 7200, now - 3600)], now)).toBeNull();
  });

  it('takes a meeting starting within 24 h as upcoming', () => {
    const soon = meeting('soon', now + 3 * 3600);
    expect(nextBarMeeting([soon], now)).toEqual({
      event: soon,
      start: now + 3 * 3600,
      end: now + 4 * 3600,
      phase: 'upcoming'
    });
  });

  it('prefers the one that started first among running/joinable/upcoming', () => {
    const running = meeting('running', now - 600, now + 600);
    const joinable = meeting('joinable', now + 300);
    const later = meeting('later', now + 7200);
    const result = nextBarMeeting([later, joinable, running], now);
    expect(result?.event).toBe(running);
    expect(result?.phase).toBe('running');
    expect(nextBarMeeting([later, joinable], now)?.phase).toBe('joinable');
  });

  it('ignores events without a start', () => {
    expect(nextBarMeeting([{ id: 'x', kind: 31923, tags: [] }], now)).toBeNull();
  });
});

describe('canJoinMeetingNow (card and bar share it)', () => {
  it('is open in the join window and while the meeting runs', () => {
    expect(canJoinMeetingNow('joinable', false)).toBe(true);
    expect(canJoinMeetingNow('running', false)).toBe(true);
  });

  it('is closed before the window and after the end', () => {
    expect(canJoinMeetingNow('upcoming', false)).toBe(false);
    expect(canJoinMeetingNow('past', false)).toBe(false);
  });

  it('is open in any phase while the channel call runs', () => {
    expect(canJoinMeetingNow('upcoming', true)).toBe(true);
    expect(canJoinMeetingNow('past', true)).toBe(true);
  });
});

describe('meetingTitle', () => {
  it('reads the title tag, then name, else empty', () => {
    expect(meetingTitle({ tags: [['title', 'Elternabend']] })).toBe('Elternabend');
    expect(meetingTitle({ tags: [['name', 'Alt']] })).toBe('Alt');
    expect(meetingTitle({ tags: [] })).toBe('');
  });
});

// QA round 3 C1: "Termin planen" opened at 14:58 pre-filled 09:00–10:00 today.
describe('defaultMeetingSlot', () => {
  it('starts at the next full half hour, one hour long, the same day', () => {
    expect(defaultMeetingSlot(new Date(2026, 9, 2, 14, 58))).toEqual({
      startDate: '2026-10-02',
      startTime: '15:00',
      endDate: '2026-10-02',
      endTime: '16:00'
    });
    expect(defaultMeetingSlot(new Date(2026, 9, 2, 15, 0, 0))).toMatchObject({
      startTime: '15:30',
      endTime: '16:30'
    });
    expect(defaultMeetingSlot(new Date(2026, 9, 2, 9, 1))).toMatchObject({
      startTime: '09:30',
      endTime: '10:30'
    });
  });
  it('the last same-day slot is 22:30–23:30', () => {
    expect(defaultMeetingSlot(new Date(2026, 9, 2, 22, 10))).toEqual({
      startDate: '2026-10-02',
      startTime: '22:30',
      endDate: '2026-10-02',
      endTime: '23:30'
    });
  });
  it('past 23:00 it is tomorrow 09:00 (across a month end too)', () => {
    expect(defaultMeetingSlot(new Date(2026, 9, 31, 22, 45))).toEqual({
      startDate: '2026-11-01',
      startTime: '09:00',
      endDate: '2026-11-01',
      endTime: '10:00'
    });
    expect(defaultMeetingSlot(new Date(2026, 9, 2, 23, 40))).toMatchObject({
      startDate: '2026-10-03',
      startTime: '09:00'
    });
  });
});

// QA round 3 K3: the card's "Beitreten" turned on up to a minute late.
describe('nextMeetingBoundary', () => {
  /** @param {number} start @param {number} end */
  const ev = (start, end) => ({
    kind: 31923,
    tags: [
      ['start', String(start)],
      ['end', String(end)]
    ]
  });
  it('is the next of bar-lookahead, join window, start and end after now', () => {
    const e = ev(100_000, 103_600);
    expect(nextMeetingBoundary([e], 0)).toBe(100_000 - 86_400);
    expect(nextMeetingBoundary([e], 20_000)).toBe(100_000 - 900);
    expect(nextMeetingBoundary([e], 99_100)).toBe(100_000);
    expect(nextMeetingBoundary([e], 100_000)).toBe(103_600);
    expect(nextMeetingBoundary([e], 103_600)).toBeNull();
  });
  it('takes the earliest across meetings and skips ones without times', () => {
    expect(
      nextMeetingBoundary([ev(200_000, 203_600), ev(150_000, 153_600), { tags: [] }], 140_000)
    ).toBe(150_000 - 900);
  });
});
