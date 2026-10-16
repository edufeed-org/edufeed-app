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
  it('keeps running and future events, soonest first', () => {
    const r = pickUpcomingEvents(
      [ev('a', 2000), ev('b', 500, 1500), ev('c', 500, 900), ev('d', 1200)],
      now
    );
    expect(r.map((e) => e.id)).toEqual(['b', 'd', 'a']);
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

describe('panelState', () => {
  it('loading only while unsettled and short', () => {
    expect(panelState([], false)).toBe('loading');
    expect(panelState([1, 2], false)).toBe('show');
    expect(panelState([1], true)).toBe('hide');
    expect(panelState([1, 2, 3], true)).toBe('show');
  });
});
