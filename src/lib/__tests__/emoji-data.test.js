// @ts-nocheck
/** @vitest-environment node */
/**
 * emoji-data.js — lazy per-locale unicode emoji datasets plus the pure
 * search/skin-tone helpers shared by EmojiPicker and the `:` autocomplete.
 */
import { describe, it, expect } from 'vitest';
import {
  emojiDataLocale,
  loadEmojiData,
  normalizeEmojiQuery,
  matchEmojiEntry,
  searchUnicodeEmojis,
  withSkinTone,
  EMOJI_GROUP_ORDER
} from '$lib/helpers/emoji-data.js';

const GRIN = {
  u: '😀',
  g: 0,
  l: 'grinning face',
  t: ['face', 'grin'],
  s: ['grinning', 'grinning_face']
};
const BEAM = {
  u: '😁',
  g: 0,
  l: 'beaming face with smiling eyes',
  t: ['eye', 'grin'],
  s: ['beaming_face', 'grin']
};
const THUMBS = {
  u: '👍',
  g: 1,
  l: 'Daumen hoch',
  t: ['daumen', 'gut', 'like'],
  s: ['+1', 'thumbsup', 'yes'],
  k: ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']
};
const FIRE = { u: '🔥', g: 5, l: 'Feuer', t: ['brennen', 'flamme', 'heiß'], s: ['fire'] };
const ENTRIES = [GRIN, BEAM, THUMBS, FIRE];

describe('emojiDataLocale', () => {
  it('maps app locales to a generated dataset and falls back to English', () => {
    expect(emojiDataLocale('de')).toBe('de');
    expect(emojiDataLocale('de-CH')).toBe('de');
    expect(emojiDataLocale('en')).toBe('en');
    expect(emojiDataLocale('fr')).toBe('en');
    expect(emojiDataLocale(undefined)).toBe('en');
  });
});

describe('loadEmojiData', () => {
  it('loads the generated German dataset with localized keywords and English shortcodes', async () => {
    const de = await loadEmojiData('de');
    expect(de.length).toBeGreaterThan(1800);
    const thumbs = de.find((e) => e.u === '👍');
    expect(thumbs).toMatchObject({ l: 'Daumen hoch', s: ['+1', 'thumbsup', 'yes'] });
    expect(thumbs.k).toHaveLength(5);
    expect(de.every((e) => EMOJI_GROUP_ORDER.includes(e.g))).toBe(true);
  });

  it('returns the same promise for repeated loads', () => {
    expect(loadEmojiData('en')).toBe(loadEmojiData('en'));
  });
});

describe('normalizeEmojiQuery', () => {
  it('case-folds and reads underscores as spaces', () => {
    expect(normalizeEmojiQuery('  Daumen_Hoch ')).toBe('daumen hoch');
  });
});

describe('matchEmojiEntry', () => {
  it('ranks exact keyword, then keyword prefix, then inner-word prefix, then substring', () => {
    expect(matchEmojiEntry(BEAM, 'grin')).toBe(0);
    expect(matchEmojiEntry(GRIN, 'grin')).toBe(0); // tag "grin"
    expect(matchEmojiEntry(GRIN, 'grinn')).toBe(1);
    expect(matchEmojiEntry(THUMBS, 'hoch')).toBe(2); // word inside "Daumen hoch"
    expect(matchEmojiEntry(THUMBS, 'umen')).toBe(3);
    expect(matchEmojiEntry(FIRE, 'grin')).toBe(-1);
  });

  it('prefers a keyword that starts with the query over one that merely contains the word', () => {
    const crossed = {
      u: '🫰',
      g: 1,
      l: 'Hand mit gekreuztem Zeigefinger und Daumen',
      t: [],
      s: ['hand_with_index_finger_and_thumb_crossed']
    };
    expect(searchUnicodeEmojis('daum', [crossed, THUMBS]).map((e) => e.u)).toEqual(['👍', '🫰']);
  });

  it('matches shortcodes with underscores read as spaces', () => {
    expect(matchEmojiEntry(GRIN, 'grinning face')).toBe(0);
  });
});

describe('searchUnicodeEmojis', () => {
  it('orders exact matches first and keeps dataset order within a rank', () => {
    expect(searchUnicodeEmojis('grin', ENTRIES).map((e) => e.u)).toEqual(['😀', '😁']);
    expect(searchUnicodeEmojis('grinn', ENTRIES).map((e) => e.u)).toEqual(['😀']);
  });

  it('searches localized keywords and English shortcodes alike', () => {
    expect(searchUnicodeEmojis('feuer', ENTRIES)[0]).toBe(FIRE);
    expect(searchUnicodeEmojis('fire', ENTRIES)[0]).toBe(FIRE);
    expect(searchUnicodeEmojis('+1', ENTRIES)[0]).toBe(THUMBS);
  });

  it('is bounded and empty for blank queries', () => {
    expect(searchUnicodeEmojis('grin', ENTRIES, 1)).toHaveLength(1);
    expect(searchUnicodeEmojis('   ', ENTRIES)).toEqual([]);
  });

  it('finds German keywords in the real dataset', async () => {
    const de = await loadEmojiData('de');
    expect(searchUnicodeEmojis('daumen hoch', de)[0].u).toBe('👍');
    expect(
      searchUnicodeEmojis('feuer', de)
        .slice(0, 3)
        .map((e) => e.u)
    ).toContain('🔥');
    expect(searchUnicodeEmojis('herz', de).map((e) => e.u)).toContain('❤️');
  });
});

describe('withSkinTone', () => {
  it('returns the tone variant, or the base form for tone 0 / emojis without tones', () => {
    expect(withSkinTone(THUMBS, 0)).toBe('👍');
    expect(withSkinTone(THUMBS, 3)).toBe('👍🏽');
    expect(withSkinTone(THUMBS, 5)).toBe('👍🏿');
    expect(withSkinTone(FIRE, 3)).toBe('🔥');
  });
});
