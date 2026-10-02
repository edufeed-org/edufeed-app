/**
 * Channel calendars on the community calendar (M5): which channels to read,
 * how their meetings are grouped per relay, and how they join the community's
 * own events.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  channelCalendarPointers,
  pointersByRelay,
  toChannelMeetings,
  mergeChannelMeetings
} from '$lib/groups/channel-calendar.js';

const COMMUNITY = 'c'.repeat(64);
const AUTHOR = 'a'.repeat(64);
const RELAY_C = 'wss://groups.example/c/root1';

/**
 * @param {string} d
 * @param {string[][]} hTags
 * @param {object} [extra]
 */
function meeting(d, hTags, extra = {}) {
  return {
    id: d.padEnd(64, '0'),
    pubkey: AUTHOR,
    kind: 31923,
    created_at: 1_790_000_000,
    content: '',
    sig: 'f'.repeat(128),
    tags: [
      ['d', d],
      ['title', `Meeting ${d}`],
      ['start', '1790010000'],
      ['end', '1790013600'],
      ...hTags
    ],
    ...extra
  };
}

describe('channelCalendarPointers', () => {
  it('lists the root (as General), the discovered channels and legacy pointers once each', () => {
    const pointers = channelCalendarPointers({
      legacy: [
        { id: 'legacy1', relay: 'wss://old.example', name: 'alt' },
        { id: 'chan1', relay: 'wss://GROUPS.example/c/root1', name: 'dupe' }
      ],
      rootChannel: { id: 'root1', relay: RELAY_C, name: 'Community name' },
      channels: [{ id: 'chan1', relay: RELAY_C, name: 'arbeitszimmer' }],
      generalName: 'General'
    });
    expect(pointers).toEqual([
      { id: 'root1', relay: RELAY_C, name: 'General' },
      { id: 'chan1', relay: RELAY_C, name: 'arbeitszimmer' },
      { id: 'legacy1', relay: 'wss://old.example', name: 'alt' }
    ]);
  });

  it('skips unaddressable pointers and tolerates missing sources', () => {
    expect(
      channelCalendarPointers({
        legacy: [{ id: '', relay: RELAY_C }],
        channels: [{ id: 'x', relay: 'https://not-a-relay' }]
      })
    ).toEqual([]);
    expect(channelCalendarPointers({})).toEqual([]);
  });
});

describe('pointersByRelay', () => {
  it('groups channel ids per (normalised) relay, deduped', () => {
    expect(
      pointersByRelay([
        { id: 'a', relay: RELAY_C },
        { id: 'b', relay: 'wss://GROUPS.example/c/root1' },
        { id: 'a', relay: RELAY_C },
        { id: 'z', relay: 'wss://other.example' }
      ])
    ).toEqual([
      { relay: RELAY_C, ids: ['a', 'b'] },
      { relay: 'wss://other.example', ids: ['z'] }
    ]);
  });
});

describe('toChannelMeetings', () => {
  const pointers = [
    { id: 'chan1', relay: RELAY_C, name: 'arbeitszimmer' },
    { id: 'root1', relay: RELAY_C, name: 'General' }
  ];

  it('keeps valid single-h meetings of the community channels, with channel name and link', () => {
    const out = toChannelMeetings([meeting('m1', [['h', 'chan1']])], pointers, {
      communityNpub: 'npub1community'
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Meeting m1');
    expect(out[0].channelMeeting).toEqual({
      id: 'chan1',
      name: 'arbeitszimmer',
      href: '/c/npub1community?view=channels&channel=chan1'
    });
  });

  it('drops meetings of foreign channels, two-h events, community-h events and invalid ones', () => {
    const out = toChannelMeetings(
      [
        meeting('foreign', [['h', 'elsewhere']]),
        meeting('double', [
          ['h', 'chan1'],
          ['h', 'root1']
        ]),
        meeting('mixed', [
          ['h', 'chan1'],
          ['h', COMMUNITY]
        ]),
        meeting('public', [['h', COMMUNITY]]),
        {
          ...meeting('notitle', [['h', 'chan1']]),
          tags: [
            ['d', 'x'],
            ['h', 'chan1']
          ]
        },
        { ...meeting('allday', [['h', 'chan1']]), kind: 31922 }
      ],
      pointers,
      { communityNpub: 'npub1community' }
    );
    expect(out).toEqual([]);
  });

  it('drops meetings a moderator deleted (kind 9005 e-tag), keeps the rest', () => {
    const gone = meeting('gone', [['h', 'chan1']]);
    const kept = meeting('kept', [['h', 'chan1']]);
    const out = toChannelMeetings([gone, kept], pointers, {
      communityNpub: 'npub1community',
      deletions: [
        {
          kind: 9005,
          tags: [
            ['h', 'chan1'],
            ['e', gone.id]
          ]
        },
        { kind: 9005, tags: [['e']] }
      ]
    });
    expect(out.map((e) => e.title)).toEqual(['Meeting kept']);
  });

  it('encodes the channel id in the link', () => {
    const out = toChannelMeetings(
      [meeting('m1', [['h', 'a b&c']])],
      [{ id: 'a b&c', relay: RELAY_C, name: 'x' }],
      { communityNpub: 'npub1c' }
    );
    expect(out[0].channelMeeting.href).toBe('/c/npub1c?view=channels&channel=a%20b%26c');
  });
});

describe('mergeChannelMeetings', () => {
  it('appends channel meetings, deduped by coordinate, community events first', () => {
    const own = { id: '1', originalEvent: meeting('pub', [['h', COMMUNITY]]) };
    const m1 = { id: '2', originalEvent: meeting('m1', [['h', 'chan1']]), channelMeeting: {} };
    const m1Again = { id: '3', originalEvent: meeting('m1', [['h', 'chan1']]), channelMeeting: {} };
    expect(mergeChannelMeetings([own], [m1, m1Again])).toEqual([own, m1]);
  });

  it('returns the community list untouched when there are no meetings', () => {
    const list = [{ id: '1', originalEvent: meeting('pub', [['h', COMMUNITY]]) }];
    expect(mergeChannelMeetings(list, [])).toBe(list);
  });
});
