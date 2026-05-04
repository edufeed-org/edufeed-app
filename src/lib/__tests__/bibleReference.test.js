/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  BIBLE_BOOKS,
  findBookMatches,
  findExactBook,
  parseAndCanonicalize
} from '$lib/helpers/educational/bibleReference.js';

describe('parseAndCanonicalize — German bible references', () => {
  describe('valid inputs canonicalize to German short form', () => {
    /** @type {Array<[string, string]>} */
    const cases = [
      // NT short forms — already canonical, should round-trip identically
      ['Mt 5,3-12', 'Mt 5,3-12'],
      ['Joh 3,16', 'Joh 3,16'],
      ['Lk 2,1', 'Lk 2,1'],
      ['Mk 1,1', 'Mk 1,1'],
      ['Apg 2,1-4', 'Apg 2,1-4'],
      ['Röm 8,28', 'Röm 8,28'],
      ['1 Kor 13,1-3', '1 Kor 13,1-3'],
      ['Offb 1,8', 'Offb 1,8'],
      // OT
      ['Ps 23', 'Ps 23'],
      ['1 Mo 1,1', '1 Mo 1,1'],
      ['Hes 1,1-3,15', 'Hes 1,1-3,15'],
      // Long forms get normalized to short
      ['Matthäus 5,3-12', 'Mt 5,3-12'],
      ['Johannes 3,16', 'Joh 3,16'],
      ['1. Mose 1,1', '1 Mo 1,1'],
      ['1. Korinther 13,1-3', '1 Kor 13,1-3'],
      // Lists
      ['Mt 5; Mk 2', 'Mt 5; Mk 2'],
      ['Mt 5,3-12; Lk 6,20-26', 'Mt 5,3-12; Lk 6,20-26']
    ];

    for (const [input, expected] of cases) {
      it(`"${input}" → "${expected}"`, async () => {
        const result = await parseAndCanonicalize(input);
        expect(result.ok).toBe(true);
        expect(result.canonical).toBe(expected);
        expect(result.osis).toBeTruthy();
      });
    }
  });

  describe('invalid inputs', () => {
    /** @type {string[]} */
    const cases = [
      'Bergpredigt',
      '',
      '   ',
      'Mt 99,1', // non-existent chapter
      'random text without a reference',
      'Hello World'
    ];

    for (const input of cases) {
      it(`"${input}" returns ok=false`, async () => {
        const result = await parseAndCanonicalize(input);
        expect(result.ok).toBe(false);
        expect(result.canonical).toBeNull();
        expect(result.osis).toBeNull();
      });
    }
  });

  describe('verse-list within a chapter', () => {
    it('"Mt 5,3.5-7" splits into separate entries', async () => {
      const result = await parseAndCanonicalize('Mt 5,3.5-7');
      expect(result.ok).toBe(true);
      // Parser emits two OSIS entities (verse 3, then verses 5-7).
      expect(result.canonical).toBe('Mt 5,3; Mt 5,5-7');
    });
  });
});

describe('BIBLE_BOOKS — typeahead data', () => {
  it('contains all 73 books in canonical order', () => {
    expect(BIBLE_BOOKS).toHaveLength(73);
    expect(BIBLE_BOOKS[0]).toEqual({ short: '1 Mo', long: '1. Mose' });
    expect(BIBLE_BOOKS.find((b) => b.short === 'Mt')?.long).toBe('Matthäus');
    expect(BIBLE_BOOKS.find((b) => b.short === 'Offb')?.long).toBe('Offenbarung');
  });
});

describe('findBookMatches', () => {
  it('returns empty array for empty / whitespace input', () => {
    expect(findBookMatches('')).toEqual([]);
    expect(findBookMatches('   ')).toEqual([]);
  });

  it('matches diacritic-typed long form', () => {
    const results = findBookMatches('Matthäus');
    expect(results.some((b) => b.short === 'Mt')).toBe(true);
  });

  it('matches accent-folded query against accented book', () => {
    const results = findBookMatches('matthaus');
    expect(results.some((b) => b.short === 'Mt')).toBe(true);
  });

  it('"ma" prefix returns Markus, Maleachi, Matthäus, …', () => {
    const longs = findBookMatches('ma').map((b) => b.long);
    expect(longs).toContain('Markus');
    expect(longs).toContain('Maleachi');
    expect(longs).toContain('Matthäus');
  });

  it('matches short form prefix ("Mt" → Matthäus)', () => {
    const results = findBookMatches('Mt');
    expect(results[0].short).toBe('Mt');
  });

  it('respects the limit', () => {
    expect(findBookMatches('a', 3)).toHaveLength(3);
  });
});

describe('findExactBook', () => {
  it('matches long German form', () => {
    expect(findExactBook('Matthäus')?.short).toBe('Mt');
    expect(findExactBook('1. Korinther')?.short).toBe('1 Kor');
  });

  it('matches short form', () => {
    expect(findExactBook('Mt')?.short).toBe('Mt');
    expect(findExactBook('Offb')?.short).toBe('Offb');
  });

  it('is accent-insensitive and case-insensitive', () => {
    expect(findExactBook('matthaus')?.short).toBe('Mt');
    expect(findExactBook('MATTHÄUS')?.short).toBe('Mt');
  });

  it('returns null for partial / unknown input', () => {
    expect(findExactBook('Matt')).toBeNull();
    expect(findExactBook('')).toBeNull();
    expect(findExactBook('Foo')).toBeNull();
  });
});
