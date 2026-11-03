/**
 * Tests for calendarEventRsvpLoader — kind 31925 (NIP-52) RSVPs for a
 * calendar event. Covers the relay set: calendar relays, the event's own
 * seen relays, and the author's NIP-65 read/inbox relays, deduplicated and
 * capped.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

/** @type {string[][]} */
let fetchEventsCalls;
/** @type {any[]} */
let fetchEventsOpts;
/** @type {any[]} */
let fetchEventsFilters;

vi.mock('$lib/loaders/base.js', () => ({
  fetchEvents: vi.fn((relays, filter, opts) => {
    fetchEventsCalls.push(relays);
    fetchEventsFilters.push(filter);
    fetchEventsOpts.push(opts);
    return of();
  })
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCalendarRelays: () => ['wss://calendar.example/']
}));

/** @type {string[]} */
let mockReadRelays;
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getReadRelays: vi.fn(() => Promise.resolve(mockReadRelays))
}));

/** @type {Set<string> | undefined} */
let mockSeenRelays;
vi.mock('applesauce-core/helpers', () => ({
  getSeenRelays: vi.fn(() => mockSeenRelays),
  // Identity normalization keeps assertions in this file string-exact; real
  // normalizeURL behavior (trailing slash, lowercasing) is applesauce's own
  // concern, not this loader's.
  normalizeURL: (/** @type {string} */ url) => url
}));

import { calendarEventRsvpLoader } from '$lib/loaders/rsvp.js';

/** @param {any} overrides */
function makeCalendarEvent(overrides = {}) {
  return {
    kind: 31923,
    pubkey: 'author-pubkey',
    tags: [['d', 'event-123']],
    ...overrides
  };
}

/** Flush the microtask queue so the async extra-relays leg resolves. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  fetchEventsCalls = [];
  fetchEventsOpts = [];
  fetchEventsFilters = [];
  mockSeenRelays = undefined;
  mockReadRelays = [];
});

describe('calendarEventRsvpLoader', () => {
  it('queries calendar relays with the #a filter and cache enabled', () => {
    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    sub.unsubscribe();

    expect(fetchEventsCalls[0]).toEqual(['wss://calendar.example/']);
    expect(fetchEventsOpts[0]).toEqual({ cache: true });
  });

  it("also queries the event's seen relays", async () => {
    mockSeenRelays = new Set(['wss://seen.example/']);

    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    expect(fetchEventsCalls).toHaveLength(2);
    expect(fetchEventsCalls[1]).toContain('wss://seen.example/');
  });

  it("also queries the author's NIP-65 read/inbox relays", async () => {
    mockReadRelays = ['wss://inbox.example/'];

    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    expect(fetchEventsCalls).toHaveLength(2);
    expect(fetchEventsCalls[1]).toContain('wss://inbox.example/');
  });

  it('dedupes extra relays already covered by the calendar relays', async () => {
    mockSeenRelays = new Set(['wss://calendar.example/']);
    mockReadRelays = ['wss://calendar.example/'];

    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    // Nothing left to ask beyond the calendar relays -> no second request.
    expect(fetchEventsCalls).toHaveLength(1);
  });

  it('dedupes seen relays against inbox relays', async () => {
    mockSeenRelays = new Set(['wss://shared.example/']);
    mockReadRelays = ['wss://shared.example/', 'wss://inbox.example/'];

    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    expect(fetchEventsCalls).toHaveLength(2);
    const extras = fetchEventsCalls[1];
    expect(extras.filter((/** @type {string} */ r) => r === 'wss://shared.example/')).toHaveLength(
      1
    );
    expect(extras).toContain('wss://inbox.example/');
  });

  it('caps the number of extra relays beyond the calendar relays', async () => {
    mockReadRelays = Array.from({ length: 20 }, (_, i) => `wss://extra-${i}.example/`);

    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    expect(fetchEventsCalls).toHaveLength(2);
    expect(fetchEventsCalls[1].length).toBeLessThanOrEqual(8);
  });

  it('does not issue a second request when there are no extra relays', async () => {
    const sub = calendarEventRsvpLoader(makeCalendarEvent()).subscribe();
    await flush();
    sub.unsubscribe();

    expect(fetchEventsCalls).toHaveLength(1);
  });

  it('builds the #a filter from the calendar event coordinate', () => {
    calendarEventRsvpLoader(
      makeCalendarEvent({ kind: 31922, pubkey: 'abc', tags: [['d', 'xyz']] })
    ).subscribe();

    expect(fetchEventsFilters[0]).toEqual({
      kinds: [31925],
      '#a': ['31922:abc:xyz'],
      limit: 200
    });
  });
});
