/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  pickMaterials,
  pickHeroMaterial,
  pickUpcomingEvents,
  pickArticles,
  panelState
} from '$lib/helpers/landing-showcase.js';

/** @param {number} id @param {number} created_at @param {object} [extra] */
const amb = (id, created_at, extra = {}) => ({
  id,
  pubkey: 'p',
  identifier: `d-${id}`,
  name: `M${id}`,
  created_at,
  image: null,
  ...extra
});

describe('pickMaterials', () => {
  it('newest first, unnamed dropped, deduped by address, capped', () => {
    const r = pickMaterials(
      [
        amb(1, 10),
        amb(2, 30),
        amb(3, 20, { name: '' }),
        amb(4, 40, { identifier: 'd-2' }),
        amb(5, 5)
      ],
      3
    );
    expect(r.map((x) => x.id)).toEqual([4, 1, 5]);
  });
});

describe('pickMaterials and busy authors', () => {
  it('one item per author, so a busy source cannot fill the panel', () => {
    const r = pickMaterials(
      [
        amb(1, 50, { pubkey: 'busy' }),
        amb(2, 40, { pubkey: 'busy' }),
        amb(3, 30, { pubkey: 'busy' }),
        amb(4, 20, { pubkey: 'quiet' }),
        amb(5, 10, { pubkey: 'other' })
      ],
      3
    );
    expect(r.map((x) => x.id)).toEqual([1, 4, 5]);
  });

  it('fills up from the busy author when there are too few authors', () => {
    const r = pickMaterials(
      [amb(1, 50, { pubkey: 'busy' }), amb(2, 40, { pubkey: 'busy' }), amb(3, 30, { pubkey: 'q' })],
      3
    );
    expect(r.map((x) => x.id)).toEqual([1, 3, 2]);
  });
});

describe('pickHeroMaterial', () => {
  it('prefers the newest item with an image', () => {
    expect(pickHeroMaterial([amb(1, 50), amb(2, 10, { image: 'https://x/i.png' })])?.id).toBe(2);
  });
  it('falls back to the newest named item, then null', () => {
    expect(pickHeroMaterial([amb(1, 5), amb(2, 9)])?.id).toBe(2);
    expect(pickHeroMaterial([])).toBeNull();
  });
});

describe('pickUpcomingEvents', () => {
  const now = 1000;
  /** @param {string} id @param {number} start @param {number} [end] @param {string[][]} [tags] */
  const ev = (id, start, end, tags = []) => ({
    id,
    start,
    end,
    originalEvent: { kind: 31923, tags }
  });
  it('only events starting from today on, soonest first', () => {
    const day = 86_400;
    const noon = 20_000 * day + day / 2; // 12:00 UTC
    const r = pickUpcomingEvents(
      [
        ev('later', noon + 3 * day),
        ev('running-course', noon - 30 * day, noon + 60 * day),
        ev('this-morning', noon - 3 * 3600),
        ev('yesterday', noon - day),
        ev('tonight', noon + 6 * 3600)
      ],
      noon
    );
    expect(r.map((e) => e.id)).toEqual(['this-morning', 'tonight', 'later']);
  });
  it('drops channel meetings', () => {
    const r = pickUpcomingEvents([ev('m', 2000, undefined, [['h', 'group']]), ev('x', 3000)], now);
    expect(r.map((e) => e.id)).toEqual(['x']);
  });
});

describe('pickArticles', () => {
  /** @param {string} id @param {string} d @param {number} created_at @param {string} [title] @param {number} [published_at] */
  const art = (id, d, created_at, title = 'T', published_at) => ({
    id,
    pubkey: 'p',
    kind: 30023,
    created_at,
    tags: [
      ['d', d],
      ['title', title],
      ...(published_at ? [['published_at', String(published_at)]] : [])
    ]
  });
  it('titled only, newest published first, deduped by d', () => {
    const r = pickArticles(
      [art('1', 'a', 10), art('2', 'b', 20, ''), art('3', 'c', 5, 'T', 99), art('4', 'a', 30)],
      3
    );
    expect(r.map((e) => e.id)).toEqual(['3', '4']);
  });
});

describe('pickArticles and busy authors', () => {
  /** @param {string} id @param {string} pubkey @param {number} created_at */
  const art = (id, pubkey, created_at) => ({
    id,
    pubkey,
    kind: 30023,
    created_at,
    tags: [
      ['d', id],
      ['title', `T${id}`]
    ]
  });
  it('one article per author first, then the rest by date', () => {
    const r = pickArticles(
      [art('1', 'a', 50), art('2', 'a', 40), art('3', 'b', 30), art('4', 'a', 20)],
      3
    );
    expect(r.map((e) => e.id)).toEqual(['1', '3', '2']);
  });
});

describe('panelState', () => {
  it('loading only while unsettled and short', () => {
    expect(panelState([], false)).toBe('loading');
    expect(panelState([1, 2], false)).toBe('show');
    expect(panelState([1], true)).toBe('hide');
    expect(panelState([1, 2, 3], true)).toBe('show');
  });
});

describe('landingCommunities', () => {
  const ev = (/** @type {string} */ pubkey, /** @type {number} */ created_at) => ({
    pubkey,
    created_at,
    kind: 10222
  });
  it('named profiles only, newest first, deduped, capped', async () => {
    const { landingCommunities } = await import('$lib/helpers/landing-showcase.js');
    const profiles = new Map([
      ['a', { name: 'A', about: 'x', picture: 'https://p/a' }],
      ['b', { display_name: 'B' }],
      ['c', { name: '  ' }]
    ]);
    const r = landingCommunities(
      [ev('a', 1), ev('b', 5), ev('c', 9), ev('a', 3), ev('d', 7)],
      profiles,
      ['a', 'b', 'c', 'd'],
      2
    );
    expect(r).toEqual([
      { pubkey: 'b', name: 'B', about: '', picture: '' },
      { pubkey: 'a', name: 'A', about: 'x', picture: 'https://p/a' }
    ]);
  });
});

describe('heroPending', () => {
  it('pending while any enabled source has not settled', async () => {
    const { heroPending } = await import('$lib/helpers/landing-showcase.js');
    const enabled = { learning: true, events: true, articles: false, communities: true };
    const done = { learning: true, events: true, articles: false, communities: true };
    expect(heroPending(enabled, done)).toBe(false);
    expect(heroPending(enabled, { ...done, events: false })).toBe(true);
    expect(heroPending(enabled, { ...done, communities: false })).toBe(true);
    // a disabled source never holds the hero
    expect(heroPending({ ...enabled, events: false }, { ...done, events: false })).toBe(false);
  });
});

describe('showcaseFilters', () => {
  it('content by a listed account OR h-tagged into a listed community', async () => {
    const { showcaseFilters } = await import('$lib/helpers/landing-showcase.js');
    expect(showcaseFilters([30142], ['a', 'b'], 12)).toEqual([
      { kinds: [30142], authors: ['a', 'b'], limit: 12 },
      { kinds: [30142], '#h': ['a', 'b'], limit: 12 }
    ]);
  });
  it('no sources, no filters — nothing may be loaded', async () => {
    const { showcaseFilters } = await import('$lib/helpers/landing-showcase.js');
    expect(showcaseFilters([30142], [], 12)).toEqual([]);
  });
  it('per author: a busy source cannot use up the window of the others', async () => {
    const { showcaseFilters } = await import('$lib/helpers/landing-showcase.js');
    expect(showcaseFilters([30023], ['a', 'b'], 12, 3)).toEqual([
      { kinds: [30023], authors: ['a'], limit: 3 },
      { kinds: [30023], authors: ['b'], limit: 3 },
      { kinds: [30023], '#h': ['a', 'b'], limit: 12 }
    ]);
  });
});

describe('landingCommunities and the showcase lists', () => {
  it('only communities on the lists', async () => {
    const { landingCommunities } = await import('$lib/helpers/landing-showcase.js');
    const profiles = new Map([
      ['edu', { name: 'Edu' }],
      ['btc', { name: 'Bitcoin Talk' }]
    ]);
    const events = [
      { pubkey: 'edu', created_at: 1, kind: 10222 },
      { pubkey: 'btc', created_at: 2, kind: 10222 }
    ];
    expect(landingCommunities(events, profiles, ['edu']).map((c) => c.name)).toEqual(['Edu']);
    expect(landingCommunities(events, profiles, [])).toEqual([]);
  });
});

describe('pickUpcomingEvents and all-day events across time zones', () => {
  /** @param {string} tz @param {() => void} fn */
  const inZone = (tz, fn) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      fn();
    } finally {
      process.env.TZ = prev;
    }
  };
  // 2026-10-19 as an all-day (31922) event: start = UTC midnight of that date
  const day = Date.UTC(2026, 9, 19) / 1000;
  const allDay = (/** @type {string} */ id, /** @type {number} */ start) => ({
    id,
    kind: 31922,
    start,
    originalEvent: { kind: 31922, tags: [] }
  });

  it('west of UTC, today’s all-day event stays (its UTC midnight is before local midnight)', () => {
    inZone('America/New_York', () => {
      const nowSec = Date.UTC(2026, 9, 19, 15) / 1000; // 11:00 in New York
      const r = pickUpcomingEvents(
        [allDay('today', day), allDay('yesterday', day - 86_400)],
        nowSec
      );
      expect(r.map((e) => e.id)).toEqual(['today']);
    });
  });

  it('east of UTC, yesterday’s all-day event does not sneak in', () => {
    inZone('Europe/Berlin', () => {
      const nowSec = Date.UTC(2026, 9, 18, 23) / 1000; // 01:00 on the 19th in Berlin
      const r = pickUpcomingEvents(
        [allDay('today', day), allDay('yesterday', day - 86_400)],
        nowSec
      );
      expect(r.map((e) => e.id)).toEqual(['today']);
    });
  });
});
