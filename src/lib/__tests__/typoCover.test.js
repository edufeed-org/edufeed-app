/**
 * Pure-helper tests for the typo-cover module.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { splitTitle, stringColorHue, titleLayout } from '$lib/helpers/educational/typoCover.js';

describe('splitTitle', () => {
  it('returns empty result for null / undefined / empty / whitespace-only input', () => {
    const expected = { leading: [], script: '', trailing: [] };
    expect(splitTitle(null)).toEqual(expected);
    expect(splitTitle(undefined)).toEqual(expected);
    expect(splitTitle('')).toEqual(expected);
    expect(splitTitle('   ')).toEqual(expected);
  });

  it('returns single word as script, no leading/trailing', () => {
    expect(splitTitle('Reformation')).toEqual({
      leading: [],
      script: 'Reformation',
      trailing: []
    });
  });

  it('puts first word as leading, second as script when n=2', () => {
    expect(splitTitle('Hello World')).toEqual({
      leading: ['Hello'],
      script: 'World',
      trailing: []
    });
  });

  it('splits a 3-word title at floor(n/2) — the mockup case', () => {
    expect(splitTitle('Morgen bestimme ich')).toEqual({
      leading: ['Morgen'],
      script: 'bestimme',
      trailing: ['ich']
    });
  });

  it('splits a 5-word title at floor(n/2)', () => {
    expect(splitTitle('Mathematische Grundlagen für Klasse 5')).toEqual({
      leading: ['Mathematische', 'Grundlagen'],
      script: 'für',
      trailing: ['Klasse', '5']
    });
  });

  it('collapses multiple consecutive spaces', () => {
    expect(splitTitle('a  b   c')).toEqual({
      leading: ['a'],
      script: 'b',
      trailing: ['c']
    });
  });

  it('keeps a single very long word as the script word', () => {
    const long = 'Beziehungsgeschehen';
    expect(splitTitle(long)).toEqual({
      leading: [],
      script: long,
      trailing: []
    });
  });
});

describe('stringColorHue', () => {
  it('returns null for null / undefined / empty / whitespace-only input', () => {
    expect(stringColorHue(null)).toBeNull();
    expect(stringColorHue(undefined)).toBeNull();
    expect(stringColorHue('')).toBeNull();
    expect(stringColorHue('   ')).toBeNull();
  });

  it('is deterministic — same input always returns the same hue', () => {
    expect(stringColorHue('hello')).toBe(stringColorHue('hello'));
    expect(stringColorHue('some-resource-id')).toBe(stringColorHue('some-resource-id'));
  });

  it('normalizes input via trim + uppercase', () => {
    expect(stringColorHue('foo')).toBe(stringColorHue('FOO'));
    expect(stringColorHue('  foo  ')).toBe(stringColorHue('FOO'));
    expect(stringColorHue('FoO')).toBe(stringColorHue('FOO'));
  });

  it('returns a number in [0, 360)', () => {
    for (const s of ['a', 'hello world', 'morgen-bestimme-ich', 'ä', '12345']) {
      const h = stringColorHue(s);
      expect(typeof h).toBe('number');
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it('matches known vectors (locks in spec conformance)', () => {
    // "A" → 65 % 360 = 65
    expect(stringColorHue('A')).toBe(65);
    // "FOO" → 70 + 79*256 + 79*65536 = 5197638 → 5197638 % 360 = 318
    expect(stringColorHue('FOO')).toBe(318);
  });

  it('does not throw on long input (BigInt path is safe)', () => {
    const long = 'a'.repeat(500);
    expect(() => stringColorHue(long)).not.toThrow();
  });
});

describe('titleLayout', () => {
  it('returns "short" for empty / null / whitespace input', () => {
    expect(titleLayout(null)).toBe('short');
    expect(titleLayout(undefined)).toBe('short');
    expect(titleLayout('')).toBe('short');
    expect(titleLayout('   ')).toBe('short');
  });

  it('returns "short" for the mockup three-word title', () => {
    expect(titleLayout('Morgen bestimme ich')).toBe('short');
  });

  it('returns "short" for a single word', () => {
    expect(titleLayout('Reformation')).toBe('short');
  });

  it('returns "short" for a 6-word ≤50-char title (at the boundary)', () => {
    // exactly 6 words, ~36 chars
    expect(titleLayout('Eine kleine Idee zum Thema Liebe')).toBe('short');
  });

  it('returns "long" when word count exceeds the threshold', () => {
    // 7 words triggers long even if short
    expect(titleLayout('a b c d e f g')).toBe('long');
  });

  it('returns "long" when character count exceeds the threshold', () => {
    // 5 words but the long German compound pushes us over 50 chars
    expect(titleLayout('Bildungsplattform Religionspaedagogik fuer Lehrkraefte schule')).toBe(
      'long'
    );
  });

  it('returns "long" for the real-world overflow case', () => {
    const title =
      '"Anders sein" heißt einmalig sein – und doch als Klasse zusammenzugehören. ' +
      'Eine Unterrichtsidee mit dem Wendebuch "Ich bin anders als du – ich bin wie du"';
    expect(titleLayout(title)).toBe('long');
  });
});
