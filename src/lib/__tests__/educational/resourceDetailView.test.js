/**
 * Unit tests for the editorial detail-view presentation helpers.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  splitTitle,
  guardScriptAccent,
  formatCreatorsLine,
  summarizeExtensionFacets
} from '$lib/helpers/educational/resourceDetailView.js';
import { parseExtensionTags } from '$lib/helpers/educational/parseExtensionTags.js';

describe('splitTitle', () => {
  it('returns everything in main for a single word, no accent', () => {
    expect(splitTitle('Abendmahl')).toEqual({ main: 'Abendmahl', script: '', tail: '' });
  });

  it('accents the second word of a two-word title', () => {
    expect(splitTitle('Morgen bestimme')).toEqual({
      main: 'Morgen',
      script: 'bestimme',
      tail: ''
    });
  });

  it('accents the longest interior word for 3+ words', () => {
    expect(splitTitle('Morgen bestimme ich')).toEqual({
      main: 'Morgen',
      script: 'bestimme',
      tail: 'ich'
    });
  });

  it('keeps words before/after the accent intact', () => {
    expect(splitTitle('Eine kurze wunderbare Reise heute')).toEqual({
      main: 'Eine kurze',
      script: 'wunderbare',
      tail: 'Reise heute'
    });
  });

  it('handles empty / whitespace input without throwing', () => {
    expect(splitTitle('')).toEqual({ main: '', script: '', tail: '' });
    expect(splitTitle('   ')).toEqual({ main: '', script: '', tail: '' });
    expect(splitTitle(/** @type {any} */ (null))).toEqual({ main: '', script: '', tail: '' });
  });

  it('collapses internal whitespace runs', () => {
    expect(splitTitle('Morgen   bestimme')).toEqual({
      main: 'Morgen',
      script: 'bestimme',
      tail: ''
    });
  });
});

describe('guardScriptAccent', () => {
  it('returns parts unchanged for a short title with a short accent', () => {
    const parts = { main: 'Morgen', script: 'bestimme', tail: 'ich' };
    expect(guardScriptAccent(parts, 'Morgen bestimme ich')).toEqual(parts);
  });

  it('suppresses the accent for a long title, folding words back into main in order', () => {
    const full =
      'Fürchtet euch nicht: Christus ist auferstanden! Eine Unterrichtseinheit zu Ostern mit Thematisierung orthodoxer Osterfeierlichkeiten';
    const parts = splitTitle(full);
    expect(parts.script).not.toBe('');
    const guarded = guardScriptAccent(parts, full);
    expect(guarded).toEqual({ main: full, script: '', tail: '' });
  });

  it('suppresses the accent when the accent word is very long, even on a short title', () => {
    const parts = { main: 'Eine', script: 'Osterfeierlichkeiten', tail: 'heute' };
    expect(guardScriptAccent(parts, 'Eine Osterfeierlichkeiten heute')).toEqual({
      main: 'Eine Osterfeierlichkeiten heute',
      script: '',
      tail: ''
    });
  });

  it('passes through empty / short input without throwing', () => {
    const empty = { main: '', script: '', tail: '' };
    expect(guardScriptAccent(empty, '')).toEqual(empty);
    expect(guardScriptAccent(empty, /** @type {any} */ (null))).toEqual(empty);
  });
});

describe('formatCreatorsLine', () => {
  it('returns empty string for no names', () => {
    expect(formatCreatorsLine([])).toBe('');
    expect(formatCreatorsLine(null)).toBe('');
    expect(formatCreatorsLine(undefined)).toBe('');
  });

  it('returns the single name verbatim (no truncation)', () => {
    expect(formatCreatorsLine(['KPH Wien/NÖ – Zentrum Fortbildung Religion'])).toBe(
      'KPH Wien/NÖ – Zentrum Fortbildung Religion'
    );
  });

  it('joins two names with an ampersand', () => {
    expect(formatCreatorsLine(['M. Gruber', 'S. Leitner'])).toBe('M. Gruber & S. Leitner');
  });

  it('collapses 3+ names to "A, B et al."', () => {
    expect(formatCreatorsLine(['M. Gruber', 'S. Leitner', 'A. Hofer', 'T. Brandl'])).toBe(
      'M. Gruber, S. Leitner et al.'
    );
  });

  it('drops falsy entries before counting', () => {
    expect(formatCreatorsLine(['M. Gruber', '', /** @type {any} */ (null)])).toBe('M. Gruber');
  });
});

describe('summarizeExtensionFacets', () => {
  /**
   * @param {string[][]} tags
   * @param {{ limit?: number, locale?: string }} [opts]
   */
  const facetsFrom = (tags, opts) =>
    summarizeExtensionFacets(parseExtensionTags(/** @type {any} */ ({ tags })), opts);

  it('returns an empty list when there are no extension tags', () => {
    expect(facetsFrom([['d', 'x']])).toEqual([]);
    expect(summarizeExtensionFacets(null)).toEqual([]);
  });

  it('surfaces a scalar facet with its first value and full items list', () => {
    const facts = facetsFrom([['ekw:method', 'Bibeltheater']]);
    expect(facts).toEqual([
      {
        ns: 'ekw',
        facetName: 'method',
        kind: 'scalar',
        value: 'Bibeltheater',
        items: ['Bibeltheater'],
        count: 1
      }
    ]);
  });

  it('keeps every value of a multi-value scalar facet in items', () => {
    const facts = facetsFrom([
      ['ekw:bibleReference', 'Psalm 34,15'],
      ['ekw:bibleReference', 'Jesaja 9,1-5'],
      ['ekw:bibleReference', 'Matthäus 5,43-48']
    ]);
    expect(facts).toEqual([
      {
        ns: 'ekw',
        facetName: 'bibleReference',
        kind: 'scalar',
        value: 'Psalm 34,15',
        items: ['Psalm 34,15', 'Jesaja 9,1-5', 'Matthäus 5,43-48'],
        count: 3
      }
    ]);
  });

  it('treats a single "true" scalar as a value-less boolean fact', () => {
    const facts = facetsFrom([['ekw:plainLanguage', 'true']]);
    expect(facts).toEqual([
      { ns: 'ekw', facetName: 'plainLanguage', kind: 'boolean', value: '', items: [], count: 1 }
    ]);
  });

  it('hides a single "false" scalar flag', () => {
    expect(facetsFrom([['ekw:plainLanguage', 'false']])).toEqual([]);
  });

  it('surfaces a concept facet using its localized prefLabel', () => {
    const facts = facetsFrom(
      [
        ['ekw:schoolType:id', 'https://w3id.org/example/gym'],
        ['ekw:schoolType:prefLabel:de', 'Gymnasium'],
        ['ekw:schoolType:prefLabel:en', 'Grammar School']
      ],
      { locale: 'de' }
    );
    expect(facts).toEqual([
      {
        ns: 'ekw',
        facetName: 'schoolType',
        kind: 'concept',
        value: 'Gymnasium',
        items: ['Gymnasium'],
        count: 1
      }
    ]);
  });

  it('respects the limit option', () => {
    const facts = facetsFrom(
      [
        ['ekw:method', 'Bibeltheater'],
        ['ekw:duration', '45'],
        ['ekw:material', 'gering']
      ],
      { limit: 2 }
    );
    expect(facts).toHaveLength(2);
  });
});
