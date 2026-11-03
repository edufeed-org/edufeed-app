/** @vitest-environment node */
// Edufeed Forms, "Answers with several values": every multi-valued answer is
// ONE `response` tag whose value joins the entries with `;` — option ids for
// multi-select, the concepts' external URIs for vocabulary-bound fields, the
// entries for text-array. Readers split on `;` and drop empty entries.
//
// The values below have the shapes the generic /forms/<naddr>/respond path
// hands to buildResponseTags: FieldsRenderer joins checkbox-group ids itself,
// FormConceptPicker emits SelectedConcept objects, and FormRenderer's submit
// validation trims text-array entries into a string array.
import { describe, it, expect } from 'vitest';
import { buildResponseTags, parseResponseTags, validateField } from '$lib/helpers/forms.js';

const LEVEL_A = 'https://w3id.org/kim/educationalLevel/level_A';
const LEVEL_C = 'https://w3id.org/kim/educationalLevel/level_C';
const PK = 'a'.repeat(64);

/** @type {import('$lib/helpers/forms.js').FormField[]} */
const fields = [
  { id: 'name', type: 'text', label: 'Name', options: {} },
  { id: 'notes', type: 'textarea', label: 'Notes', options: {} },
  {
    id: 'topics',
    type: 'checkbox',
    label: 'Topics',
    options: {
      options: [
        { id: 'oer', label: 'OER' },
        { id: 'workshop', label: 'Workshop' }
      ]
    }
  },
  {
    id: 'formats',
    type: 'select',
    label: 'Formats',
    options: {
      multiple: true,
      options: [
        { id: 'f1', label: 'Online' },
        { id: 'f2', label: 'On site' }
      ]
    }
  },
  {
    id: 'rating',
    type: 'radio',
    label: 'Rating',
    options: { options: [{ id: 'r5', label: '5' }] }
  },
  {
    id: 'level',
    type: 'select',
    label: 'Level',
    options: { multiple: true },
    vocab: { address: `39737:${PK}:educationalLevel`, relay: 'wss://vocab.example' }
  },
  { id: 'authors', type: 'text-array', label: 'Authors', options: {} }
];

const submitted = {
  name: 'Ada',
  notes: 'first; second',
  topics: 'oer;workshop',
  formats: 'f1;f2',
  rating: 'r5',
  level: [
    {
      id: LEVEL_A,
      nostrCoord: `39738:${PK}:level_A`,
      relay: 'wss://vocab.example',
      labels: { de: 'Elementarbereich' }
    },
    {
      id: LEVEL_C,
      nostrCoord: `39738:${PK}:level_C`,
      relay: 'wss://vocab.example',
      labels: { de: 'Sekundarstufe I' }
    }
  ],
  authors: ['Doe, Jane', 'Smith, John']
};

/** @param {string[][]} tags @param {string} id */
const responseFor = (tags, id) => tags.find((t) => t[0] === 'response' && t[1] === id);

describe('buildResponseTags — answers with several values', () => {
  it('serialises vocabulary answers as the concepts URIs joined by ";"', () => {
    const tags = buildResponseTags(submitted);
    expect(responseFor(tags, 'level')).toEqual([
      'response',
      'level',
      `${LEVEL_A};${LEVEL_C}`,
      '{}'
    ]);
  });

  it('serialises text-array answers joined by ";", not ","', () => {
    const tags = buildResponseTags(submitted);
    expect(responseFor(tags, 'authors')).toEqual([
      'response',
      'authors',
      'Doe, Jane;Smith, John',
      '{}'
    ]);
  });

  it('keeps one response tag per field and leaves already-joined option ids alone', () => {
    const tags = buildResponseTags(submitted);
    expect(tags.filter((t) => t[1] === 'level')).toHaveLength(1);
    expect(responseFor(tags, 'topics')?.[2]).toBe('oer;workshop');
    expect(responseFor(tags, 'name')?.[2]).toBe('Ada');
  });

  it('drops empty entries', () => {
    const tags = buildResponseTags({ authors: ['', 'Ada', ''], level: [] });
    expect(responseFor(tags, 'authors')?.[2]).toBe('Ada');
    expect(responseFor(tags, 'level')?.[2]).toBe('');
  });

  it('refuses an entry containing ";" instead of corrupting the answer', () => {
    expect(() => buildResponseTags({ authors: ['a;b'] })).toThrow(/;/);
  });
});

describe('parseResponseTags — answers with several values', () => {
  it('round-trips a response through build and parse with the template fields', () => {
    const values = parseResponseTags(buildResponseTags(submitted), fields);
    expect(values.level).toEqual([LEVEL_A, LEVEL_C]);
    expect(values.authors).toEqual(['Doe, Jane', 'Smith, John']);
    expect(values.topics).toEqual(['oer', 'workshop']);
    expect(values.formats).toEqual(['f1', 'f2']);
    // single-valued answers stay strings, including a ';' inside free text
    expect(values.name).toBe('Ada');
    expect(values.notes).toBe('first; second');
    expect(values.rating).toBe('r5');
  });

  it('drops empty entries when splitting', () => {
    const values = parseResponseTags([['response', 'authors', ';Ada;;Bob;', '{}']], fields);
    expect(values.authors).toEqual(['Ada', 'Bob']);
  });

  it('keeps raw strings without fields (unknown or legacy fields)', () => {
    const values = parseResponseTags([['response', 'authors', 'Ada;Bob', '{}']]);
    expect(values.authors).toBe('Ada;Bob');
  });
});

describe('validateField — text-array entries must not contain ";"', () => {
  const field = { id: 'authors', type: 'text-array', label: 'Authors', options: {} };

  it('rejects an entry with ";"', () => {
    expect(validateField(field, ['Ada', 'Doe; Jane'])).toMatch(/;/);
  });

  it('accepts entries with commas', () => {
    expect(validateField(field, ['Doe, Jane'])).toBeNull();
  });
});
