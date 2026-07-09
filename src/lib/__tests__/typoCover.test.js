/**
 * Pure-helper tests for the typo-cover module.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  formatAuthors,
  longestWordLength,
  splitTitle,
  stringColorHue,
  titleLayout
} from '$lib/helpers/educational/typoCover.js';

describe('splitTitle', () => {
  it('returns empty result for null / undefined / empty / whitespace-only input', () => {
    const expected = { leading: [], script: '', trailing: [] };
    expect(splitTitle(null)).toEqual(expected);
    expect(splitTitle(undefined)).toEqual(expected);
    expect(splitTitle('')).toEqual(expected);
    expect(splitTitle('   ')).toEqual(expected);
  });

  it('1-word title renders plain on the leading line, no script accent', () => {
    expect(splitTitle('Reformation')).toEqual({
      leading: ['Reformation'],
      script: '',
      trailing: []
    });
  });

  it('2-word title: word 1 leading, word 2 script, no trailing', () => {
    expect(splitTitle('Hello World')).toEqual({
      leading: ['Hello'],
      script: 'World',
      trailing: []
    });
  });

  it('3-word title: only inner word is script (mockup case)', () => {
    expect(splitTitle('Morgen bestimme ich')).toEqual({
      leading: ['Morgen'],
      script: 'bestimme',
      trailing: ['ich']
    });
  });

  it('5-word title: picks longest inner word as script', () => {
    // inner = ['Grundlagen', 'für', 'Klasse'] → longest is 'Grundlagen'
    expect(splitTitle('Mathematische Grundlagen für Klasse 5')).toEqual({
      leading: ['Mathematische'],
      script: 'Grundlagen',
      trailing: ['für', 'Klasse', '5']
    });
  });

  it('avoids prepositions in 5-word titles (regression: was picking "für")', () => {
    const { script } = splitTitle('Mathematische Grundlagen für Klasse 5');
    expect(script).not.toBe('für');
  });

  it('4-word title: picks the longer of two inner words', () => {
    // inner = ['Menschen', 'verantwortlich'] → longest is 'verantwortlich'
    expect(splitTitle('Wofür Menschen verantwortlich sind')).toEqual({
      leading: ['Wofür', 'Menschen'],
      script: 'verantwortlich',
      trailing: ['sind']
    });
  });

  it('ties broken by first occurrence', () => {
    // inner = ['ab', 'cd'] both 2 chars → 'ab' (first) wins
    expect(splitTitle('x ab cd y')).toEqual({
      leading: ['x'],
      script: 'ab',
      trailing: ['cd', 'y']
    });
  });

  it('collapses multiple consecutive spaces', () => {
    expect(splitTitle('a  b   c')).toEqual({
      leading: ['a'],
      script: 'b',
      trailing: ['c']
    });
  });

  it('keeps a single very long word as plain (1-word path)', () => {
    const long = 'Beziehungsgeschehen';
    expect(splitTitle(long)).toEqual({
      leading: [long],
      script: '',
      trailing: []
    });
  });

  it('strips trailing punctuation from the script word', () => {
    // 5 words. inner = ['tragen', 'Verantwortung:', 'Teil']
    // longest inner: 'Verantwortung:' (14 chars). Strip the colon.
    expect(splitTitle('Menschen tragen Verantwortung: Teil 2')).toEqual({
      leading: ['Menschen', 'tragen'],
      script: 'Verantwortung',
      trailing: ['Teil', '2']
    });
  });

  it('strips any of : ; , . ! ? … from the script word', () => {
    expect(splitTitle('a hello.').script).toBe('hello');
    expect(splitTitle('a what?').script).toBe('what');
    expect(splitTitle('a wow!').script).toBe('wow');
    expect(splitTitle('a etc...').script).toBe('etc');
    expect(splitTitle('a oh…').script).toBe('oh');
  });

  it('does NOT strip punctuation from leading/trailing words', () => {
    // 3 words, inner = ['world!'] (the only inner word)
    const { leading, script, trailing } = splitTitle('Hello, world! Goodbye.');
    expect(leading).toEqual(['Hello,']);
    expect(script).toBe('world');
    expect(trailing).toEqual(['Goodbye.']);
  });
});

describe('formatAuthors', () => {
  it('returns null for empty / null / all-blank input', () => {
    expect(formatAuthors([])).toBeNull();
    // @ts-expect-error — passing null intentionally
    expect(formatAuthors(null)).toBeNull();
    // @ts-expect-error — passing undefined intentionally
    expect(formatAuthors(undefined)).toBeNull();
    expect(formatAuthors(['  ', ''])).toBeNull();
  });

  it('returns the single name unchanged (no abbreviation)', () => {
    expect(formatAuthors(['laoc42'])).toBe('laoc42');
    expect(formatAuthors(['KPH Wien/NÖ – Zentrum Fortbildung Religion'])).toBe(
      'KPH Wien/NÖ – Zentrum Fortbildung Religion'
    );
  });

  it('joins two names with ampersand', () => {
    expect(formatAuthors(['Alice', 'Bob'])).toBe('Alice & Bob');
  });

  it('shows first two names plus "et al." for 3 or more', () => {
    expect(formatAuthors(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob et al.');
    expect(formatAuthors(['Alice', 'Bob', 'Carol', 'Dan', 'Eve'])).toBe('Alice, Bob et al.');
  });

  it('preserves input order (first author = primary)', () => {
    expect(formatAuthors(['Zeta', 'Alpha'])).toBe('Zeta & Alpha');
    expect(formatAuthors(['Zeta', 'Alpha', 'Mu'])).toBe('Zeta, Alpha et al.');
  });

  it('trims and filters blank entries before counting', () => {
    expect(formatAuthors([' Alice ', '', ' Bob '])).toBe('Alice & Bob');
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

describe('longestWordLength', () => {
  it('returns the longest word length', () => {
    expect(longestWordLength(['Wofür', 'Menschen'])).toBe(8);
    expect(longestWordLength(['verantwortlich'])).toBe(14);
  });

  it('returns 0 for empty input', () => {
    expect(longestWordLength([])).toBe(0);
    expect(longestWordLength(undefined)).toBe(0);
  });

  it('ignores empty strings', () => {
    expect(longestWordLength(['', 'ab'])).toBe(2);
  });
});

describe('titleLayout — pathological word length (issue #23)', () => {
  it('routes titles whose longest word cannot fit even downscaled to the long layout', () => {
    expect(titleLayout('Donaudampfschifffahrtsgesellschaft verstehen')).toBe('long');
  });

  it('keeps ordinary German compounds in the short layout', () => {
    expect(titleLayout('Wofür Menschen verantwortlich sind')).toBe('short');
  });
});
