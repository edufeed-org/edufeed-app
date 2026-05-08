// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

// Mock env so the endpoint can import without real .env values
vi.mock('$env/dynamic/private', () => ({
  env: {
    CALENDAR_RELAYS: 'wss://cal.example.com',
    FALLBACK_RELAYS: 'wss://fallback.example.com'
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
});

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

    // Referenced event lookup
    fetchEventFromRelays.mockResolvedValueOnce(
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
    );

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
