/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  BIBLE_BOOKS,
  findBookMatches,
  findExactBook,
  parseAndCanonicalize,
  toDieBibelUrl
} from '$lib/helpers/educational/bibleReference.js';

const DIE_BIBEL = 'https://www.die-bibel.de/bibel/LU17';

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

describe('toDieBibelUrl', () => {
  it('builds a die-bibel.de LU17 link for chapter-only references', () => {
    expect(toDieBibelUrl('Ps 23')).toBe(`${DIE_BIBEL}/PSA.23`);
    expect(toDieBibelUrl('1 Mo 27')).toBe(`${DIE_BIBEL}/GEN.27`);
  });

  it('builds verse-specific links for single-verse references', () => {
    expect(toDieBibelUrl('Joh 3,16')).toBe(`${DIE_BIBEL}/JHN.3.16`);
    expect(toDieBibelUrl('Mt 5,3')).toBe(`${DIE_BIBEL}/MAT.5.3`);
  });

  it('builds verse-range links for in-chapter ranges', () => {
    expect(toDieBibelUrl('Mt 5,3-12')).toBe(`${DIE_BIBEL}/MAT.5.3-12`);
    expect(toDieBibelUrl('1 Kor 13,1-3')).toBe(`${DIE_BIBEL}/1CO.13.1-3`);
  });

  it('uses USFM book codes (regression: silent-fallback hazard)', () => {
    // OSIS codes Matt/Mark/Ps must NOT leak into the URL —
    // die-bibel.de silently renders Genesis 1 for unknown book codes,
    // so MATT/MARK/PS would produce wrong-passage links with no error.
    expect(toDieBibelUrl('Mt 5,3')).toContain('/MAT.');
    expect(toDieBibelUrl('Mt 5,3')).not.toContain('/MATT.');
    expect(toDieBibelUrl('Mk 1,1')).toContain('/MRK.');
    expect(toDieBibelUrl('Mk 1,1')).not.toContain('/MARK.');
    expect(toDieBibelUrl('Ps 23')).toContain('/PSA.');
    expect(toDieBibelUrl('Ps 23')).not.toMatch(/\/PS\.23$/);
  });

  it('maps the full canonical book table to USFM codes', () => {
    /** @type {Array<[string, string]>} */
    const cases = [
      // Pentateuch
      ['1 Mo 1,1', 'GEN.1.1'],
      ['2 Mo 3,14', 'EXO.3.14'],
      ['3 Mo 19,18', 'LEV.19.18'],
      ['4 Mo 6,24', 'NUM.6.24'],
      ['5 Mo 6,4', 'DEU.6.4'],
      // Historical
      ['Jos 1,9', 'JOS.1.9'],
      ['Ri 6,12', 'JDG.6.12'],
      ['Rut 1,16', 'RUT.1.16'],
      ['1 Sam 16,7', '1SA.16.7'],
      ['2 Sam 7,12', '2SA.7.12'],
      ['1 Kön 19,12', '1KI.19.12'],
      ['2 Kön 5,14', '2KI.5.14'],
      ['1 Chr 16,11', '1CH.16.11'],
      ['2 Chr 7,14', '2CH.7.14'],
      ['Esr 7,10', 'EZR.7.10'],
      ['Neh 8,10', 'NEH.8.10'],
      ['Est 4,14', 'EST.4.14'],
      // Wisdom
      ['Hi 1,21', 'JOB.1.21'],
      ['Ps 23,1', 'PSA.23.1'],
      ['Spr 3,5', 'PRO.3.5'],
      ['Pred 3,1', 'ECC.3.1'],
      ['Hld 2,4', 'SNG.2.4'],
      // Major prophets
      ['Jes 40,31', 'ISA.40.31'],
      ['Jer 29,11', 'JER.29.11'],
      ['Klgl 3,22', 'LAM.3.22'],
      ['Hes 36,26', 'EZK.36.26'],
      ['Dan 3,17', 'DAN.3.17'],
      // Minor prophets
      ['Hos 6,6', 'HOS.6.6'],
      ['Joel 3,1', 'JOL.3.1'],
      ['Am 5,24', 'AMO.5.24'],
      ['Obd 1,15', 'OBA.1.15'],
      ['Jona 2,3', 'JON.2.3'],
      ['Mi 6,8', 'MIC.6.8'],
      ['Nah 1,7', 'NAM.1.7'],
      ['Hab 2,4', 'HAB.2.4'],
      ['Zef 3,17', 'ZEP.3.17'],
      ['Hag 2,9', 'HAG.2.9'],
      ['Sach 9,9', 'ZEC.9.9'],
      ['Mal 3,20', 'MAL.3.20'],
      // Gospels & Acts
      ['Mt 5,3', 'MAT.5.3'],
      ['Mk 1,1', 'MRK.1.1'],
      ['Lk 2,14', 'LUK.2.14'],
      ['Joh 3,16', 'JHN.3.16'],
      ['Apg 2,1', 'ACT.2.1'],
      // Pauline
      ['Röm 8,28', 'ROM.8.28'],
      ['1 Kor 13,1', '1CO.13.1'],
      ['2 Kor 5,17', '2CO.5.17'],
      ['Gal 5,22', 'GAL.5.22'],
      ['Eph 2,8', 'EPH.2.8'],
      ['Phil 4,7', 'PHP.4.7'],
      ['Kol 3,16', 'COL.3.16'],
      ['1 Thess 5,16', '1TH.5.16'],
      ['2 Thess 3,3', '2TH.3.3'],
      ['1 Tim 6,12', '1TI.6.12'],
      ['2 Tim 1,7', '2TI.1.7'],
      ['Tit 3,5', 'TIT.3.5'],
      ['Phlm 1,6', 'PHM.1.6'],
      // General epistles
      ['Hebr 11,1', 'HEB.11.1'],
      ['Jak 1,17', 'JAS.1.17'],
      ['1 Petr 5,7', '1PE.5.7'],
      ['2 Petr 3,9', '2PE.3.9'],
      ['1 Joh 4,16', '1JN.4.16'],
      ['2 Joh 1,6', '2JN.1.6'],
      ['3 Joh 1,4', '3JN.1.4'],
      ['Jud 1,21', 'JUD.1.21'],
      // Apocalypse
      ['Offb 21,4', 'REV.21.4']
    ];
    for (const [input, expectedPath] of cases) {
      expect(toDieBibelUrl(input)).toBe(`${DIE_BIBEL}/${expectedPath}`);
    }
  });

  it('accepts long German book names', () => {
    expect(toDieBibelUrl('Matthäus 5,3-12')).toBe(`${DIE_BIBEL}/MAT.5.3-12`);
    expect(toDieBibelUrl('1. Korinther 13,1-3')).toBe(`${DIE_BIBEL}/1CO.13.1-3`);
    expect(toDieBibelUrl('1. Mose 1,1')).toBe(`${DIE_BIBEL}/GEN.1.1`);
  });

  it('is accent-insensitive and case-insensitive on the book name', () => {
    expect(toDieBibelUrl('matthaus 5,3-12')).toBe(`${DIE_BIBEL}/MAT.5.3-12`);
    expect(toDieBibelUrl('MATTHÄUS 5,3-12')).toBe(`${DIE_BIBEL}/MAT.5.3-12`);
  });

  it('collapses cross-chapter ranges to the start verse', () => {
    // die-bibel.de silently drops cross-chapter ranges in the URL —
    // collapsing to the start verse keeps the link "roughly right"
    // instead of letting the silent fallback land on the wrong page.
    expect(toDieBibelUrl('Hes 1,1-3,15')).toBe(`${DIE_BIBEL}/EZK.1.1`);
  });

  it('uses only the first reference when the entry contains ;-separated refs', () => {
    expect(toDieBibelUrl('Mt 5,3-12; Lk 6,20-26')).toBe(`${DIE_BIBEL}/MAT.5.3-12`);
  });

  it('returns null for inputs that do not start with a known book', () => {
    expect(toDieBibelUrl('Freie Methode A')).toBeNull();
    expect(toDieBibelUrl('Foo 5,3')).toBeNull();
    expect(toDieBibelUrl('Lorem ipsum')).toBeNull();
  });

  it('returns null for empty / whitespace input', () => {
    expect(toDieBibelUrl('')).toBeNull();
    expect(toDieBibelUrl('   ')).toBeNull();
  });

  it('returns null when the input has a known book but no chapter/verse digits', () => {
    expect(toDieBibelUrl('Mt')).toBeNull();
    expect(toDieBibelUrl('Matthäus')).toBeNull();
  });
});
