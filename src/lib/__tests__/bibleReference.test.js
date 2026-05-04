/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseAndCanonicalize } from '$lib/helpers/educational/bibleReference.js';

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
