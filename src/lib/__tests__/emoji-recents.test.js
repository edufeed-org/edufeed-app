// @ts-nocheck
/** @vitest-environment node */
/**
 * emoji-recents.js — most-recent-first, unique, capped list of used emojis;
 * stored JSON is untrusted and parsed defensively.
 */
import { describe, it, expect } from 'vitest';
import { RECENT_LIMIT, pushRecent, parseRecents, recentKey } from '$lib/helpers/emoji-recents.js';

const THUMBS = { type: 'unicode', u: '👍' };
const FIRE = { type: 'unicode', u: '🔥' };
const DOGE = { type: 'custom', shortcode: 'doge', url: 'https://x/doge.png' };

describe('pushRecent', () => {
  it('puts the latest pick first and never repeats an emoji', () => {
    let list = pushRecent([], THUMBS);
    list = pushRecent(list, FIRE);
    list = pushRecent(list, DOGE);
    list = pushRecent(list, THUMBS);
    expect(list).toEqual([THUMBS, DOGE, FIRE]);
  });

  it('treats a custom emoji with the same shortcode as the same entry (newest url wins)', () => {
    const moved = { type: 'custom', shortcode: 'doge', url: 'https://y/doge.gif' };
    expect(pushRecent([DOGE], moved)).toEqual([moved]);
  });

  it('caps the list', () => {
    let list = [];
    for (let i = 0; i < RECENT_LIMIT + 5; i++)
      list = pushRecent(list, { type: 'unicode', u: `e${i}` });
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].u).toBe(`e${RECENT_LIMIT + 4}`);
  });
});

describe('recentKey', () => {
  it('keys unicode by character and custom by shortcode', () => {
    expect(recentKey(THUMBS)).toBe('u:👍');
    expect(recentKey(DOGE)).toBe('c:doge');
  });
});

describe('parseRecents', () => {
  it('round-trips a stored list', () => {
    expect(parseRecents(JSON.stringify([FIRE, DOGE]))).toEqual([FIRE, DOGE]);
  });

  it('drops malformed entries, unsafe urls, extra fields and duplicates', () => {
    const raw = JSON.stringify([
      FIRE,
      { type: 'unicode', u: '' },
      { type: 'custom', shortcode: 'bad name', url: 'https://x' },
      { type: 'custom', shortcode: 'js', url: 'javascript:alert(1)' },
      { type: 'other' },
      null,
      { ...THUMBS, extra: 1 },
      FIRE
    ]);
    expect(parseRecents(raw)).toEqual([FIRE, THUMBS]);
  });

  it('returns [] for missing, invalid or non-array JSON', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('{nope')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
  });
});
