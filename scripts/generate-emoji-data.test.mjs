/** @vitest-environment node */
/**
 * generate-emoji-data.mjs — turns emojibase-data into the slim per-locale
 * datasets the picker and autocomplete search. The wire form matters most:
 * a reaction must use the same code points every other client sends.
 */
import { describe, it, expect } from 'vitest';
import { buildLocaleData, hexcodeToString } from './generate-emoji-data.mjs';

const SHORTCODES = { '1F44D': ['+1', 'thumbsup', 'yes'], 2764: 'heart', '1F525': 'fire' };
const THUMBS = {
  hexcode: '1F44D',
  label: 'thumbs up',
  group: 1,
  type: 1,
  order: 10,
  tags: ['+1', 'hand', 'thumbs up'],
  skins: ['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF'].map((mod, i) => ({
    hexcode: `1F44D-${mod}`,
    tone: i + 1
  }))
};
const HEART = { hexcode: '2764', label: 'red heart', group: 0, type: 0, order: 5, tags: ['heart'] };
const FIRE = { hexcode: '1F525', label: 'fire', group: 5, type: 1, order: 20, tags: ['flame'] };
const SKIN = { hexcode: '1F3FB', label: 'light skin tone', group: 2, type: 1, order: 1 };
const REGIONAL = { hexcode: '1F1E6', label: 'regional indicator A', type: 1, order: 2 };
const HANDSHAKE = {
  hexcode: '1F91D',
  label: 'handshake',
  group: 1,
  type: 1,
  order: 30,
  skins: [
    { hexcode: '1F91D-1F3FB', tone: 1 },
    { hexcode: '1F91D-1F3FB-1F3FC', tone: [1, 2] }
  ]
};

describe('hexcodeToString', () => {
  it('turns a dash-separated hexcode into the code point sequence', () => {
    expect(hexcodeToString('1F44D')).toBe('👍');
    expect(hexcodeToString('1F1E9-1F1EA')).toBe('🇩🇪');
  });
});

describe('buildLocaleData', () => {
  const entries = buildLocaleData([FIRE, SKIN, HEART, THUMBS, REGIONAL, HANDSHAKE], SHORTCODES);

  it('drops skin-tone components and regional indicators and sorts by emojibase order', () => {
    expect(entries.map((e) => e.l)).toEqual(['red heart', 'thumbs up', 'fire', 'handshake']);
  });

  it('emits the fully-qualified wire form: FE0F only for text-default emojis', () => {
    expect(entries.find((e) => e.l === 'red heart')?.u).toBe('❤️');
    expect(entries.find((e) => e.l === 'thumbs up')?.u).toBe('👍');
  });

  it('carries group, label, keywords (minus the label itself) and shortcodes as arrays', () => {
    const thumbs = entries.find((e) => e.l === 'thumbs up');
    expect(thumbs).toMatchObject({ g: 1, t: ['+1', 'hand'], s: ['+1', 'thumbsup', 'yes'] });
    expect(entries.find((e) => e.l === 'red heart')?.s).toEqual(['heart']);
  });

  it('lists the five uniform skin-tone variants, light to dark, when all exist', () => {
    const thumbs = entries.find((e) => e.l === 'thumbs up');
    expect(thumbs?.k).toEqual(['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿']);
  });

  it('omits skins when the emoji has no uniform variant for every tone', () => {
    expect(entries.find((e) => e.l === 'handshake')?.k).toBeUndefined();
  });
});
