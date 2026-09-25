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
const GRIN = { u: '😀', g: 0, l: 'grinning face', t: ['face', 'smile'], s: ['grinning'] };
const BEAM = { u: '😁', g: 0, l: 'beaming face', t: ['smile'], s: ['grin'] };
const SMILE = { u: '😊', g: 0, l: 'smiling face', t: ['smile'], s: ['blush'] };
const THUMBS = {
  u: '👍',
  g: 1,
  l: 'thumbs up',
  t: [],
  s: ['+1', 'thumbsup'],
  k: ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']
};
const UNICODE = [GRIN, BEAM, SMILE, THUMBS];

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
    const hits = searchEmojis('dog', SETS, UNICODE);
    expect(hits.slice(0, 2).map((h) => h.type)).toEqual(['custom', 'custom']);
    expect(hits[0].shortcode).toBe('doge'); // shorter prefix match first
    expect(hits[1].shortcode).toBe('dogedance_sm');
  });

  it('finds unicode emojis by shortcode/keyword — exact before prefix — with char, name and label', () => {
    const hits = searchEmojis('grin', [], UNICODE);
    expect(hits.map((h) => h.type === 'unicode' && h.char)).toEqual(['😁', '😀']);
    expect(hits[0]).toEqual({ type: 'unicode', char: '😁', name: 'grin', label: 'beaming face' });
  });

  it('is case-insensitive and bounded', () => {
    const hits = searchEmojis('SMILE', SETS, UNICODE, { limit: 2 });
    expect(hits.map((h) => h.type === 'unicode' && h.char)).toEqual(['😀', '😁']);
  });

  it('applies the chosen skin tone to the inserted character', () => {
    const [hit] = searchEmojis('thumbs', [], UNICODE, { skinTone: 4 });
    expect(hit).toMatchObject({ char: '👍🏾', name: '+1' });
  });

  it('returns nothing for a query nothing matches, and copes without a dataset', () => {
    expect(searchEmojis('zzzzqq', SETS, UNICODE)).toEqual([]);
    expect(searchEmojis('grin', SETS, [])).toEqual([]);
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
