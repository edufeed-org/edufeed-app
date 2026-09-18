// @ts-nocheck
/** @vitest-environment node */
/**
 * emoji-autocomplete.js — the pure half of the Slack-style ':' autocomplete
 * (laoc, 2026-09-18): detect an in-progress `:query` before the caret, rank
 * matches from the user's custom packs and the unicode set, splice the pick
 * into the text, and list the custom emojis a draft still references.
 */
import { describe, it, expect } from 'vitest';
import {
  detectEmojiQuery,
  searchEmojis,
  applyEmoji,
  customEmojisIn
} from '$lib/helpers/emoji-autocomplete.js';

const DOGE = { shortcode: 'dogedance_sm', url: 'https://x/doge.gif' };
const DOG2 = { shortcode: 'doge', url: 'https://x/doge2.png' };
const CAT = { shortcode: 'cat_wow', url: 'https://x/cat.png' };
const SETS = [
  { packName: 'Doge', emojis: [DOGE, DOG2] },
  { packName: 'Cats', emojis: [CAT] }
];

describe('detectEmojiQuery', () => {
  it('finds a :query at the text start and after whitespace', () => {
    expect(detectEmojiQuery(':dog', 4)).toEqual({ start: 0, query: 'dog' });
    expect(detectEmojiQuery('hallo :dog', 10)).toEqual({ start: 6, query: 'dog' });
  });

  it('needs at least two characters after the colon', () => {
    expect(detectEmojiQuery(':d', 2)).toBeNull();
    expect(detectEmojiQuery(':', 1)).toBeNull();
  });

  it('ignores colons inside words (times, URLs) and closed shortcodes', () => {
    expect(detectEmojiQuery('um 12:30', 8)).toBeNull();
    expect(detectEmojiQuery('https://x', 9)).toBeNull();
    expect(detectEmojiQuery(':doge: ', 7)).toBeNull();
    expect(detectEmojiQuery(':doge:', 6)).toBeNull();
  });

  it('only looks at the text before the caret', () => {
    expect(detectEmojiQuery(':dog rest', 4)).toEqual({ start: 0, query: 'dog' });
    expect(detectEmojiQuery(':dog rest', 9)).toBeNull();
  });

  it('accepts shortcode characters only', () => {
    expect(detectEmojiQuery(':thumbs_up+1', 12)).toEqual({ start: 0, query: 'thumbs_up+1' });
    expect(detectEmojiQuery(':dog!', 5)).toBeNull();
  });
});

describe('searchEmojis', () => {
  it('lists custom emojis first, prefix matches before substring matches', () => {
    const hits = searchEmojis('dog', SETS);
    expect(hits.slice(0, 2).map((h) => h.type)).toEqual(['custom', 'custom']);
    expect(hits[0].shortcode).toBe('doge'); // shorter prefix match first
    expect(hits[1].shortcode).toBe('dogedance_sm');
  });

  it('finds unicode emojis by keyword and reports the character', () => {
    const hits = searchEmojis('grin', []);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type).toBe('unicode');
    expect(hits[0].char).toBe('😀');
    expect(hits.every((h) => h.type === 'unicode')).toBe(true);
  });

  it('is case-insensitive, bounded and never repeats a unicode emoji', () => {
    const hits = searchEmojis('SMILE', SETS, 5);
    expect(hits.length).toBeLessThanOrEqual(5);
    const chars = hits.filter((h) => h.type === 'unicode').map((h) => h.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it('returns nothing for a query nothing matches', () => {
    expect(searchEmojis('zzzzqq', SETS)).toEqual([]);
  });
});

describe('applyEmoji', () => {
  it('replaces the :query with the pick plus a trailing space and moves the caret behind it', () => {
    expect(applyEmoji('hallo :dog rest', 6, 10, ':doge:')).toEqual({
      text: 'hallo :doge: rest',
      caret: 12
    });
  });

  it('works for unicode picks too — the caret counts UTF-16 units like selectionStart', () => {
    expect(applyEmoji(':gri', 0, 4, '😀')).toEqual({ text: '😀 ', caret: 3 });
  });

  it('adds no second space when whitespace already follows the caret', () => {
    expect(applyEmoji('a :ca b', 2, 5, ':cat_wow:').text).toBe('a :cat_wow: b');
  });
});

describe('customEmojisIn', () => {
  it('lists each custom emoji whose shortcode is in the text, once', () => {
    expect(customEmojisIn(':doge: und :doge: und :cat_wow:', SETS)).toEqual([DOG2, CAT]);
  });

  it('does not match a shortcode that is only a prefix of another', () => {
    expect(customEmojisIn(':dogedance_sm:', SETS)).toEqual([DOGE]);
  });

  it('is empty without matches', () => {
    expect(customEmojisIn('nur text', SETS)).toEqual([]);
  });
});
