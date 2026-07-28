/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseFormTemplate, normalizeRenderElement } from '$lib/helpers/forms/format.js';

/** @param {string[][]} fieldTags */
const evt = (fieldTags) => ({
  kind: 30168,
  pubkey: 'pk',
  content: '',
  created_at: 0,
  tags: [['d', 'x'], ['name', 'F'], ['settings', '{}'], ...fieldTags]
});

describe('normalizeRenderElement', () => {
  it('maps Formstr names to ours', () => {
    expect(normalizeRenderElement('shortText')).toBe('text');
    expect(normalizeRenderElement('longText')).toBe('textarea');
    expect(normalizeRenderElement('radioButton')).toBe('radio');
    expect(normalizeRenderElement('dropdown')).toBe('select');
    expect(normalizeRenderElement('number')).toBe('number');
    expect(normalizeRenderElement('label')).toBe('label');
  });
  it('passes our own vocabulary through unchanged', () => {
    for (const t of [
      'text',
      'textarea',
      'radio',
      'checkbox',
      'select',
      'date',
      'text-array',
      'creator',
      'amb-relation',
      'external-urls'
    ])
      expect(normalizeRenderElement(t)).toBe(t);
  });
  it('leaves an unknown name as-is (degrades to text downstream)', () => {
    expect(normalizeRenderElement('holo9000')).toBe('holo9000');
  });
  it('does not leak inherited prototype members for crafted names', () => {
    expect(normalizeRenderElement('constructor')).toBe('constructor');
    expect(normalizeRenderElement('toString')).toBe('toString');
    expect(normalizeRenderElement('hasOwnProperty')).toBe('hasOwnProperty');
  });
});

describe('parseFormTemplate normalizes foreign renderElement', () => {
  it('a Formstr shortText field parses as type text', () => {
    const p = parseFormTemplate(
      evt([['field', 'q1', 'text', 'Name?', '[]', JSON.stringify({ renderElement: 'shortText' })]])
    );
    expect(p.fields[0].type).toBe('text');
  });
  it('a Formstr radioButton field parses as type radio', () => {
    const p = parseFormTemplate(
      evt([
        [
          'field',
          'q2',
          'option',
          'Pick',
          JSON.stringify([['a', 'A']]),
          JSON.stringify({ renderElement: 'radioButton' })
        ]
      ])
    );
    expect(p.fields[0].type).toBe('radio');
  });
  it('a Formstr checkboxes field parses as select with multiple=true', () => {
    const p = parseFormTemplate(
      evt([
        [
          'field',
          'q3',
          'option',
          'Many',
          JSON.stringify([
            ['a', 'A'],
            ['b', 'B']
          ]),
          JSON.stringify({ renderElement: 'checkboxes' })
        ]
      ])
    );
    expect(p.fields[0].type).toBe('select');
    expect(p.fields[0].options?.multiple).toBe(true);
  });
});
