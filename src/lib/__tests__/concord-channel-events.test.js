/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  parseChannelEvents,
  startEpoch,
  isUpcoming,
  collectRsvps,
  tallyRsvps,
  buildRsvpTemplate
} from '$lib/concord/channel-events.js';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

/** @param {any} overrides */
function timeEvent(overrides = {}) {
  return {
    id: 'ev-time',
    kind: 31923,
    pubkey: ALICE,
    content: '',
    created_at: 1000,
    tags: [
      ['d', 'standup'],
      ['title', 'Standup'],
      ['start', '1800000000'],
      ['end', '1800003600'],
      ['location', 'Hive HQ']
    ],
    ...overrides
  };
}

/** @param {any} overrides */
function dateEvent(overrides = {}) {
  return {
    id: 'ev-date',
    kind: 31922,
    pubkey: ALICE,
    content: '',
    created_at: 1000,
    tags: [
      ['d', 'retreat'],
      ['title', 'Retreat'],
      ['start', '2027-01-15'],
      ['end', '2027-01-17']
    ],
    ...overrides
  };
}

describe('parseChannelEvents', () => {
  it('parses time- and date-based events with titles, sorted soonest-first', () => {
    // 31922 'Retreat' starts 2027-01-15T00:00Z (1799971200) < 31923 'Standup'
    // at 1800000000 (2027-01-15T08:00Z), so the date-based event sorts first.
    const events = parseChannelEvents([timeEvent(), dateEvent()]);
    expect(events.map((e) => e.title)).toEqual(['Retreat', 'Standup']);
    expect(startEpoch(events[0])).toBeLessThanOrEqual(startEpoch(events[1]));
    expect(events[0].dateBased).toBe(true);
    expect(events[1].location).toBe('Hive HQ');
  });

  it('keeps only the NEWEST version per (kind, author, d) coordinate', () => {
    const old = timeEvent({ id: 'old', created_at: 1000 });
    const updated = timeEvent({
      id: 'new',
      created_at: 2000,
      tags: [
        ['d', 'standup'],
        ['title', 'Standup v2'],
        ['start', '1800000000']
      ]
    });
    const events = parseChannelEvents([old, updated]);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Standup v2');
  });

  it('drops events missing a title or start', () => {
    expect(
      parseChannelEvents([
        timeEvent({
          tags: [
            ['d', 'x'],
            ['title', 'No start']
          ]
        })
      ])
    ).toEqual([]);
    expect(
      parseChannelEvents([
        timeEvent({
          tags: [
            ['d', 'x'],
            ['start', '1800000000']
          ]
        })
      ])
    ).toEqual([]);
  });
});

describe('isUpcoming', () => {
  it('is true while the event has not ended, using end (or start) as the cutoff', () => {
    const ev = parseChannelEvents([timeEvent()])[0];
    expect(isUpcoming(ev, 1800000000 - 10)).toBe(true);
    expect(isUpcoming(ev, 1800003600)).toBe(true); // inclusive at end
    expect(isUpcoming(ev, 1800003601)).toBe(false);
  });
});

describe('collectRsvps + tallyRsvps', () => {
  /** @param {string} pubkey @param {string} status @param {number} ms @param {string} [target] */
  function rsvp(pubkey, status, ms, target = 'ev-time') {
    return {
      kind: 31925,
      pubkey,
      created_at: Math.floor(ms / 1000),
      ms,
      tags: [
        ['e', target],
        ['status', status]
      ]
    };
  }

  it('buckets by e-target, validates status, latest per pubkey wins', () => {
    const byEvent = collectRsvps([
      rsvp(ALICE, 'accepted', 1000_000),
      rsvp(ALICE, 'declined', 2000_000), // supersedes
      rsvp(BOB, 'tentative', 1500_000),
      rsvp(BOB, 'partying', 1600_000), // invalid status -> dropped
      rsvp(BOB, 'accepted', 900_000, 'other-event')
    ]);
    expect([...byEvent.keys()].sort()).toEqual(['ev-time', 'other-event']);

    const tally = tallyRsvps(byEvent.get('ev-time') ?? [], ALICE);
    expect(tally.accepted).toEqual([]);
    expect(tally.declined).toEqual([ALICE]);
    expect(tally.tentative).toEqual([BOB]);
    expect(tally.mine).toBe('declined');
  });
});

describe('buildRsvpTemplate', () => {
  it('builds a kind-31925 template e-tagging the event rumor with a status', () => {
    const template = buildRsvpTemplate('ev-time', 'accepted');
    expect(template.kind).toBe(31925);
    expect(template.tags).toEqual([
      ['e', 'ev-time'],
      ['status', 'accepted']
    ]);
    expect(typeof template.created_at).toBe('number');
  });
});
