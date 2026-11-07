// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

// Mock env so the endpoint can import without real .env values
vi.mock('$env/dynamic/private', () => ({
  env: {
    CALENDAR_RELAYS: 'wss://cal.example.com',
    FALLBACK_RELAYS: 'wss://fallback.example.com',
    COMMUNIKEY_RELAYS: 'wss://communikey.example.com'
  }
}));

// Mock the server-side relay fetch helpers — the endpoint should be the only
// caller, so we drive its behaviour entirely through these mocks. Use
// vi.hoisted so the mock factory can capture the spies.
const { fetchEventFromRelays, fetchEventsFromRelays } = vi.hoisted(() => ({
  fetchEventFromRelays: vi.fn(),
  fetchEventsFromRelays: vi.fn()
}));
vi.mock('$lib/server/nostr-fetch.js', async () => {
  const actual = await vi.importActual('$lib/server/nostr-fetch.js');
  return {
    ...actual,
    fetchEventFromRelays,
    fetchEventsFromRelays
  };
});

// Hint relays are DNS-checked (SSRF guard); resolve every name publicly here
// so tests never touch the network.
vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }
}));

import { GET } from '../+server.js';

const COMMUNITY_PUBKEY = 'a'.repeat(64);
const CALENDAR_AUTHOR = 'b'.repeat(64);

/**
 * @param {Partial<import('nostr-tools').NostrEvent>} overrides
 * @returns {import('nostr-tools').NostrEvent}
 */
function makeEvent(overrides) {
  return {
    id: 'c'.repeat(64),
    pubkey: COMMUNITY_PUBKEY,
    created_at: 1_700_000_000,
    kind: 31923,
    tags: [],
    content: '',
    sig: 's'.repeat(128),
    ...overrides
  };
}

beforeEach(() => {
  fetchEventFromRelays.mockReset();
  fetchEventsFromRelays.mockReset();
  // Default: no events, no deletions.
  fetchEventsFromRelays.mockResolvedValue([]);
});

/** @param {any} filter */
const isDeletionQuery = (filter) =>
  (Array.isArray(filter) ? filter : [filter]).every((f) => f.kinds?.includes(5));

describe('ICS endpoint - community calendar (hex pubkey)', () => {
  it('returns a text/calendar response with VEVENT entries', async () => {
    // kind 0 (profile)
    fetchEventFromRelays.mockResolvedValueOnce({
      id: 'p'.repeat(64),
      pubkey: COMMUNITY_PUBKEY,
      kind: 0,
      tags: [],
      content: JSON.stringify({ name: 'Test Community', about: 'About us' }),
      created_at: 1,
      sig: 's'.repeat(128)
    });
    // kind 10222 (community def) — none for this test
    fetchEventFromRelays.mockResolvedValueOnce(null);

    fetchEventsFromRelays.mockResolvedValueOnce([
      makeEvent({
        id: 'e1'.padEnd(64, '1'),
        kind: 31923,
        tags: [
          ['d', 'evt-1'],
          ['title', 'Hello, World'],
          ['start', '1700001000'],
          ['end', '1700004600'],
          ['h', COMMUNITY_PUBKEY]
        ]
      })
    ]);

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/calendar');
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:Hello\\, World'); // ICS text escaping
    expect(body).toContain('X-WR-CALNAME:Test Community Calendar');
  });

  it('returns 400 for an invalid identifier', async () => {
    const response = await GET({
      url: new URL('https://example.org/api/calendar/not-a-thing/ics'),
      params: { id: 'not-a-thing' }
    });
    expect(response.status).toBe(400);
  });

  it('returns 200 with empty calendar body when community has no events', async () => {
    fetchEventFromRelays.mockResolvedValueOnce(null); // profile
    fetchEventFromRelays.mockResolvedValueOnce(null); // community def
    fetchEventsFromRelays.mockResolvedValueOnce([]); // calendar events

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
    expect(body).not.toContain('BEGIN:VEVENT');
  });
});

describe('ICS endpoint - NIP-52 calendar (naddr)', () => {
  it('returns a text/calendar response for a naddr calendar', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: []
    });

    // Calendar definition (kind 31924) referencing one event
    const refKind = 31923;
    const refDtag = 'evt-x';
    fetchEventFromRelays.mockResolvedValueOnce({
      id: 'cal'.padEnd(64, '0'),
      pubkey: CALENDAR_AUTHOR,
      kind: 31924,
      tags: [
        ['d', 'my-cal'],
        ['title', 'My Calendar'],
        ['a', `${refKind}:${CALENDAR_AUTHOR}:${refDtag}`]
      ],
      content: '',
      created_at: 1,
      sig: 's'.repeat(128)
    });

    // Referenced event lookup (one batched REQ)
    fetchEventsFromRelays.mockResolvedValueOnce([
      makeEvent({
        id: 'evtx'.padEnd(64, '0'),
        kind: 31923,
        pubkey: CALENDAR_AUTHOR,
        tags: [
          ['d', refDtag],
          ['title', 'Referenced Event'],
          ['start', '1700001000'],
          ['end', '1700004600']
        ]
      })
    ]);

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/calendar');
    const body = await response.text();
    expect(body).toContain('BEGIN:VEVENT');
    expect(body).toContain('SUMMARY:Referenced Event');
    expect(body).toContain('X-WR-CALNAME:My Calendar');
  });

  it('returns 404 when the naddr calendar cannot be fetched', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'missing',
      relays: []
    });
    fetchEventFromRelays.mockResolvedValueOnce(null);

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });
    expect(response.status).toBe(404);
  });
});

describe('ICS endpoint - relay order, SSRF guard, deletions', () => {
  const calendarEvent = (aTags) => ({
    id: 'cal'.padEnd(64, '0'),
    pubkey: CALENDAR_AUTHOR,
    kind: 31924,
    tags: [['d', 'my-cal'], ['title', 'My Calendar'], ...aTags],
    content: '',
    created_at: 1,
    sig: 's'.repeat(128)
  });
  const referenced = (dTag, title) =>
    makeEvent({
      id: dTag.padEnd(64, '0'),
      kind: 31923,
      pubkey: CALENDAR_AUTHOR,
      created_at: 1_700_000_000,
      tags: [
        ['d', dTag],
        ['title', title],
        ['start', '1700001000'],
        ['end', '1700004600']
      ]
    });

  it('queries configured relays before naddr hints and drops private hints', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: ['ws://plain.example.com', 'wss://127.0.0.1:7777', 'wss://hint.example.com']
    });
    fetchEventFromRelays.mockResolvedValueOnce(
      calendarEvent([['a', `31923:${CALENDAR_AUTHOR}:x`, 'wss://10.0.0.1']])
    );

    await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });

    expect(fetchEventFromRelays.mock.calls[0][1]).toEqual([
      'wss://cal.example.com',
      'wss://fallback.example.com',
      'wss://hint.example.com'
    ]);
    // The private `a`-tag hint is dropped; only configured relays remain.
    expect(fetchEventsFromRelays.mock.calls[0][1]).toEqual([
      'wss://cal.example.com',
      'wss://fallback.example.com'
    ]);
  });

  it('drops a referenced event its author deleted (NIP-09 a-deletion)', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: []
    });
    fetchEventFromRelays.mockResolvedValueOnce(
      calendarEvent([
        ['a', `31923:${CALENDAR_AUTHOR}:kept`],
        ['a', `31923:${CALENDAR_AUTHOR}:gone`]
      ])
    );
    fetchEventsFromRelays.mockImplementation(async (filter) => {
      if (!isDeletionQuery(filter)) {
        return [referenced('kept', 'Kept Event'), referenced('gone', 'Deleted Event')];
      }
      return [
        {
          id: 'd'.repeat(64),
          kind: 5,
          pubkey: CALENDAR_AUTHOR,
          created_at: 1_700_000_500,
          tags: [['a', `31923:${CALENDAR_AUTHOR}:gone`]],
          content: '',
          sig: 's'.repeat(128)
        }
      ];
    });

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });
    const body = await response.text();
    expect(body).toContain('SUMMARY:Kept Event');
    expect(body).not.toContain('Deleted Event');

    const deletionCall = fetchEventsFromRelays.mock.calls.find(([f]) => isDeletionQuery(f));
    expect(deletionCall[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kinds: [5],
          authors: [CALENDAR_AUTHOR],
          '#a': expect.arrayContaining([`31923:${CALENDAR_AUTHOR}:gone`])
        })
      ])
    );
  });

  it('returns 404 when the calendar itself was deleted', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: []
    });
    fetchEventFromRelays.mockResolvedValueOnce(calendarEvent([]));
    fetchEventsFromRelays.mockImplementation(async (filter) =>
      isDeletionQuery(filter)
        ? [
            {
              id: 'd'.repeat(64),
              kind: 5,
              pubkey: CALENDAR_AUTHOR,
              created_at: 5,
              tags: [['a', `31924:${CALENDAR_AUTHOR}:my-cal`]],
              content: '',
              sig: 's'.repeat(128)
            }
          ]
        : []
    );
    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });
    expect(response.status).toBe(404);
  });

  it('drops deleted community events and private community relays', async () => {
    fetchEventFromRelays.mockResolvedValueOnce(null); // profile
    fetchEventFromRelays.mockResolvedValueOnce({
      id: 'f'.repeat(64),
      pubkey: COMMUNITY_PUBKEY,
      kind: 10222,
      tags: [
        ['r', 'wss://community.example.com'],
        ['r', 'wss://192.168.0.2']
      ],
      content: '',
      created_at: 1,
      sig: 's'.repeat(128)
    });
    const kept = makeEvent({
      id: '1'.repeat(64),
      tags: [
        ['d', 'kept'],
        ['title', 'Kept'],
        ['start', '1700001000'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });
    const gone = makeEvent({
      id: '2'.repeat(64),
      tags: [
        ['d', 'gone'],
        ['title', 'Gone'],
        ['start', '1700001000'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });
    fetchEventsFromRelays.mockImplementation(async (filter) =>
      isDeletionQuery(filter)
        ? [
            {
              id: 'd'.repeat(64),
              kind: 5,
              pubkey: COMMUNITY_PUBKEY,
              created_at: 1,
              tags: [['e', gone.id]],
              content: '',
              sig: 's'.repeat(128)
            }
          ]
        : [kept, gone]
    );

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    const body = await response.text();
    expect(body).toContain('SUMMARY:Kept');
    expect(body).not.toContain('SUMMARY:Gone');

    const eventsCall = fetchEventsFromRelays.mock.calls.find(([f]) => !isDeletionQuery(f));
    expect(eventsCall[1]).toEqual([
      'wss://cal.example.com',
      'wss://fallback.example.com',
      'wss://community.example.com'
    ]);
  });

  it('resolves all a-tags in one batched REQ per kind, keeping only listed coordinates', async () => {
    const OTHER = 'e'.repeat(64);
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: []
    });
    fetchEventFromRelays.mockResolvedValueOnce(
      calendarEvent([
        ['a', `31923:${CALENDAR_AUTHOR}:one`],
        ['a', `31923:${OTHER}:two`],
        ['a', `31922:${CALENDAR_AUTHOR}:day`],
        ['a', `1:${CALENDAR_AUTHOR}:ignored`]
      ])
    );
    // The authors × #d cross product also matches OTHER's "one", which the
    // calendar does not list — it must not leak into the feed.
    const stray = makeEvent({
      id: '9'.repeat(64),
      pubkey: OTHER,
      tags: [
        ['d', 'one'],
        ['title', 'Stray'],
        ['start', '1700001000']
      ]
    });
    fetchEventsFromRelays.mockImplementation(async (filter) =>
      isDeletionQuery(filter) ? [] : [referenced('one', 'Listed One'), stray]
    );

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });
    const body = await response.text();
    expect(body).toContain('SUMMARY:Listed One');
    expect(body).not.toContain('Stray');

    const eventCalls = fetchEventsFromRelays.mock.calls.filter(([f]) => !isDeletionQuery(f));
    expect(eventCalls).toHaveLength(1);
    expect(fetchEventFromRelays).toHaveBeenCalledTimes(1); // only the calendar itself
    const filters = eventCalls[0][0];
    expect(filters).toEqual(
      expect.arrayContaining([
        {
          kinds: [31923],
          authors: expect.arrayContaining([CALENDAR_AUTHOR, OTHER]),
          '#d': expect.arrayContaining(['one', 'two'])
        },
        { kinds: [31922], authors: [CALENDAR_AUTHOR], '#d': ['day'] }
      ])
    );
    expect(filters).toHaveLength(2);
  });

  it('caps the a-tags it resolves at 500', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31924,
      pubkey: CALENDAR_AUTHOR,
      identifier: 'my-cal',
      relays: []
    });
    const aTags = Array.from({ length: 2000 }, (_, i) => [
      'a',
      `31923:${CALENDAR_AUTHOR}:evt-${i}`
    ]);
    fetchEventFromRelays.mockResolvedValueOnce(calendarEvent(aTags));

    await GET({
      url: new URL(`https://example.org/api/calendar/${naddr}/ics`),
      params: { id: naddr }
    });

    const [filters] = fetchEventsFromRelays.mock.calls.find(([f]) => !isDeletionQuery(f));
    expect(filters[0]['#d']).toHaveLength(500);
  });
});

describe('ICS endpoint - community definition relays', () => {
  it('reads the kind 10222 from the communikey relays plus calendar + fallback', async () => {
    fetchEventFromRelays.mockResolvedValue(null);
    await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    const defCall = fetchEventFromRelays.mock.calls.find(([f]) => f.kinds?.includes(10222));
    expect(defCall[1]).toEqual(
      expect.arrayContaining([
        'wss://communikey.example.com',
        'wss://cal.example.com',
        'wss://fallback.example.com'
      ])
    );
  });
});

describe('ICS endpoint - community profile-list access', () => {
  const MEMBER = '1'.repeat(64);
  const OUTSIDER = '2'.repeat(64);
  const LIST_AUTHOR = '3'.repeat(64);

  const communityDef = (sectionTags) => ({
    id: 'f'.repeat(64),
    pubkey: COMMUNITY_PUBKEY,
    kind: 10222,
    tags: sectionTags,
    content: '',
    created_at: 1,
    sig: 's'.repeat(128)
  });
  const calEvent = (id, pubkey, title) =>
    makeEvent({
      id: id.repeat(64),
      pubkey,
      tags: [
        ['d', title],
        ['title', title],
        ['start', '1700001000'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });

  it('keeps only events by profile-list members when the calendar section is gated', async () => {
    fetchEventFromRelays.mockResolvedValueOnce(null); // profile
    fetchEventFromRelays.mockResolvedValueOnce(
      communityDef([
        ['content', 'Calendar'],
        ['k', '31922'],
        ['k', '31923'],
        ['a', `30000:${LIST_AUTHOR}:cal-publishers`, 'wss://list.example.com']
      ])
    );
    fetchEventFromRelays.mockResolvedValueOnce({
      id: '4'.repeat(64),
      pubkey: LIST_AUTHOR,
      kind: 30000,
      tags: [
        ['d', 'cal-publishers'],
        ['p', MEMBER]
      ],
      content: '',
      created_at: 1,
      sig: 's'.repeat(128)
    });
    fetchEventsFromRelays.mockImplementation(async (filter) =>
      isDeletionQuery(filter)
        ? []
        : [calEvent('a', MEMBER, 'MemberEvent'), calEvent('b', OUTSIDER, 'OutsiderEvent')]
    );

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    const body = await response.text();
    expect(body).toContain('SUMMARY:MemberEvent');
    expect(body).not.toContain('OutsiderEvent');

    const listCall = fetchEventFromRelays.mock.calls[2];
    expect(listCall[0]).toMatchObject({
      kinds: [30000],
      authors: [LIST_AUTHOR],
      '#d': ['cal-publishers']
    });
    expect(listCall[1]).toContain('wss://list.example.com');
  });

  it('keeps every event when the calendar section has no profile list', async () => {
    fetchEventFromRelays.mockResolvedValueOnce(null); // profile
    fetchEventFromRelays.mockResolvedValueOnce(
      communityDef([
        ['content', 'Calendar'],
        ['k', '31923']
      ])
    );
    fetchEventsFromRelays.mockImplementation(async (filter) =>
      isDeletionQuery(filter)
        ? []
        : [calEvent('a', MEMBER, 'MemberEvent'), calEvent('b', OUTSIDER, 'OutsiderEvent')]
    );

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    const body = await response.text();
    expect(body).toContain('SUMMARY:MemberEvent');
    expect(body).toContain('SUMMARY:OutsiderEvent');
    expect(fetchEventFromRelays).toHaveBeenCalledTimes(2);
  });
});

describe('ICS endpoint - moderated community roster access', () => {
  const MEMBER = '1'.repeat(64);
  const OUTSIDER = '2'.repeat(64);
  const ADMIN = '3'.repeat(64);
  const PUBLISHER = '4'.repeat(64);
  const GROUP_RELAY = 'wss://groups.example.com';

  const signed = (kind, pubkey, tags, createdAt = 10) => ({
    id: String(kind).padEnd(64, '0'),
    pubkey,
    kind,
    tags,
    content: '',
    created_at: createdAt,
    sig: 's'.repeat(128)
  });
  const communityDef = (calendarTags) =>
    signed(
      10222,
      COMMUNITY_PUBKEY,
      [
        ['content', 'Calendar'],
        ['k', '31923'],
        ...calendarTags,
        ['membership', 'root1', GROUP_RELAY]
      ],
      5
    );
  const calEvent = (id, pubkey, title) =>
    makeEvent({
      id: id.repeat(64),
      pubkey,
      tags: [
        ['d', title],
        ['title', title],
        ['start', '1700001000'],
        ['h', COMMUNITY_PUBKEY]
      ]
    });
  const allEvents = [
    calEvent('a', MEMBER, 'MemberEvent'),
    calEvent('b', OUTSIDER, 'OutsiderEvent'),
    calEvent('c', ADMIN, 'AdminEvent'),
    calEvent('d', PUBLISHER, 'PublisherEvent'),
    calEvent('e', COMMUNITY_PUBKEY, 'OwnerEvent')
  ];
  const roster = [
    signed(39002, 'f'.repeat(64), [
      ['d', 'root1'],
      ['p', MEMBER]
    ]),
    signed(39001, 'f'.repeat(64), [
      ['d', 'root1'],
      ['p', ADMIN, 'admin'],
      ['p', PUBLISHER, 'publisher']
    ])
  ];

  /** @param {{roster?: any[], overrides?: any[]}} opts */
  const routeFetches = ({ roster: rosterEvents = roster, overrides = [] } = {}) =>
    fetchEventsFromRelays.mockImplementation(async (filter) => {
      const f = Array.isArray(filter) ? filter[0] : filter;
      if (isDeletionQuery(filter)) return [];
      if (f.kinds.includes(39002)) return rosterEvents;
      if (f.kinds.includes(30223)) return overrides;
      return allEvents;
    });

  const get = async (def) => {
    fetchEventFromRelays.mockResolvedValueOnce(null); // profile
    fetchEventFromRelays.mockResolvedValueOnce(def);
    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    return response.text();
  };

  it('keeps only owner + root-group members (admins included) for a members-tier section', async () => {
    routeFetches();
    const body = await get(communityDef([['access', 'members']]));
    for (const title of ['MemberEvent', 'AdminEvent', 'PublisherEvent', 'OwnerEvent']) {
      expect(body).toContain(`SUMMARY:${title}`);
    }
    expect(body).not.toContain('OutsiderEvent');

    const rosterCall = fetchEventsFromRelays.mock.calls.find(([f]) => f.kinds?.includes(39002));
    expect(rosterCall[0]).toMatchObject({ kinds: [39001, 39002], '#d': ['root1'] });
    expect(rosterCall[1]).toEqual([GROUP_RELAY]);
  });

  it('keeps only owner + role holders for a role-tier section', async () => {
    routeFetches();
    const body = await get(communityDef([['access', 'role', 'publisher']]));
    expect(body).toContain('SUMMARY:PublisherEvent');
    expect(body).toContain('SUMMARY:OwnerEvent');
    expect(body).not.toContain('MemberEvent');
    expect(body).not.toContain('AdminEvent');
  });

  it('allows only the owner when the roster cannot be fetched', async () => {
    routeFetches({ roster: [] });
    const body = await get(communityDef([['access', 'members']]));
    expect(body).toContain('SUMMARY:OwnerEvent');
    expect(body).not.toContain('MemberEvent');
    expect(body).not.toContain('AdminEvent');
  });

  it('keeps every event when the section is open', async () => {
    routeFetches();
    const body = await get(communityDef([]));
    expect(body).toContain('SUMMARY:OutsiderEvent');
    expect(body).toContain('SUMMARY:MemberEvent');
  });

  it("applies a moderator's newer kind-30223 section override", async () => {
    routeFetches({
      overrides: [
        signed(
          30223,
          ADMIN,
          [
            ['d', COMMUNITY_PUBKEY],
            ['h', COMMUNITY_PUBKEY],
            ['content', 'Calendar'],
            ['k', '31923'],
            ['access', 'members']
          ],
          20
        )
      ]
    });
    const body = await get(communityDef([]));
    expect(body).toContain('SUMMARY:MemberEvent');
    expect(body).not.toContain('OutsiderEvent');
  });

  it("ignores a publisher's section override", async () => {
    routeFetches({
      overrides: [
        signed(
          30223,
          PUBLISHER,
          [
            ['d', COMMUNITY_PUBKEY],
            ['content', 'Calendar'],
            ['k', '31923']
          ],
          20
        )
      ]
    });
    const body = await get(communityDef([['access', 'members']]));
    expect(body).not.toContain('OutsiderEvent');
  });
});

describe('ICS endpoint - Content-Disposition', () => {
  it('never puts a double quote or CR/LF into the ASCII filename fallback', async () => {
    fetchEventFromRelays.mockResolvedValueOnce({
      id: 'p'.repeat(64),
      pubkey: COMMUNITY_PUBKEY,
      kind: 0,
      tags: [],
      content: JSON.stringify({ name: 'Evil"; filename="x.exe' }),
      created_at: 1,
      sig: 's'.repeat(128)
    });
    fetchEventFromRelays.mockResolvedValueOnce(null);

    const response = await GET({
      url: new URL(`https://example.org/api/calendar/${COMMUNITY_PUBKEY}/ics`),
      params: { id: COMMUNITY_PUBKEY }
    });
    const disposition = response.headers.get('Content-Disposition');
    const fallback = disposition.match(/filename="([^"]*)"/)[1];
    expect(fallback).not.toContain('\\');
    expect(disposition.match(/"/g)).toHaveLength(2);
  });
});
