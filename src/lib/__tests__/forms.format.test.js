/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildFormTemplateTags,
  parseFormTemplate,
  generateOptionId
} from '$lib/helpers/forms/format.js';

/** @param {string[][]} tags @param {string} [content] */
const evt = (tags, content = '') => ({ kind: 30168, pubkey: 'pk', tags, content, created_at: 0 });

describe('NIP-101 encoding', () => {
  it('emits NIP-101 field-tag positions and a settings tag', () => {
    const tags = buildFormTemplateTags(
      'my-form',
      [
        {
          id: 'age',
          type: 'number',
          label: 'Your age?',
          defaultValue: '18',
          options: { required: true, min: 0 }
        },
        {
          id: 'color',
          type: 'radio',
          label: 'Favourite colour?',
          options: {
            required: true,
            options: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue', nextSection: 'sec-blue' }
            ]
          }
        }
      ],
      { name: 'Test', description: 'Desc', public: true, sections: [] }
    );

    const settingsTag = /** @type {string[]} */ (tags.find((t) => t[0] === 'settings'));
    expect(JSON.parse(settingsTag[1])).toEqual({ description: 'Desc', publicForm: true });
    // no legacy discrete tags
    expect(tags.some((t) => t[0] === 'description')).toBe(false);
    expect(tags.some((t) => t[0] === 'public')).toBe(false);

    const age = /** @type {string[]} */ (tags.find((t) => t[0] === 'field' && t[1] === 'age'));
    expect(age[2]).toBe('text'); // NIP-101 primitive
    expect(age[3]).toBe('Your age?');
    expect(JSON.parse(age[4])).toEqual([]); // options JSON at position 4
    expect(JSON.parse(age[5])).toEqual({
      renderElement: 'number',
      required: true,
      min: 0,
      defaultValue: '18'
    });

    const color = /** @type {string[]} */ (tags.find((t) => t[0] === 'field' && t[1] === 'color'));
    expect(color[2]).toBe('option');
    const triples = JSON.parse(color[4]);
    expect(triples[0]).toEqual(['red', 'Red']);
    expect(triples[1][0]).toBe('blue');
    expect(JSON.parse(triples[1][2])).toEqual({ nextSection: 'sec-blue' });
  });

  it('round-trips through parseFormTemplate', () => {
    const fields = [
      {
        id: 'topic',
        type: 'select',
        label: 'Topic',
        defaultValue: '',
        options: {
          multiple: true,
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' }
          ]
        }
      }
    ];
    const sections = [{ id: 's1', title: 'Step 1', questionIds: ['topic'] }];
    const tags = buildFormTemplateTags('rt', fields, { name: 'RT', sections });
    const parsed = parseFormTemplate(evt(tags));
    expect(parsed.name).toBe('RT');
    expect(parsed.sections).toEqual(sections);
    expect(parsed.fields[0].type).toBe('select');
    expect(parsed.fields[0].options?.multiple).toBe(true);
    expect(parsed.fields[0].options?.options).toEqual([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' }
    ]);
  });

  it('keeps extension tags (vocab, output, forkOf) unchanged', () => {
    const tags = buildFormTemplateTags(
      'x',
      [
        {
          id: 'lrt',
          type: 'select',
          label: 'Type',
          options: {},
          vocab: { address: '39737:pk:hcrt', relay: 'wss://r' },
          output: 'amb:learningResourceType'
        }
      ],
      { forkOf: { address: '30168:pk2:orig', relay: 'wss://r2' } }
    );
    expect(tags).toContainEqual(['field-vocab', 'lrt', 'a', '39737:pk:hcrt', 'wss://r']);
    expect(tags).toContainEqual(['field-output', 'lrt', 'amb:learningResourceType']);
    expect(tags).toContainEqual(['a', '30168:pk2:orig', 'wss://r2', 'forkOf']);
    // vocab-bound choice field is NOT inputType option (options come from vocab)
    expect(tags.find((t) => t[0] === 'field')?.[2]).toBe('text');
  });

  it('parses the legacy dialect (no settings tag) including option strings', () => {
    const legacy = evt([
      ['d', 'old'],
      ['name', 'Old form'],
      ['description', 'Old desc'],
      ['public'],
      [
        'field',
        'role',
        'radio',
        'Role?',
        'Teacher',
        '{"required":true,"options":["Teacher","Student"]}'
      ]
    ]);
    const parsed = parseFormTemplate(legacy);
    expect(parsed.description).toBe('Old desc');
    expect(parsed.isPublic).toBe(true);
    expect(parsed.sections).toEqual([]);
    const f = parsed.fields[0];
    expect(f.type).toBe('radio');
    expect(f.defaultValue).toBe('Teacher');
    expect(f.options?.required).toBe(true);
    expect(f.options?.options).toEqual([
      { id: 'Teacher', label: 'Teacher' },
      { id: 'Student', label: 'Student' }
    ]);
  });

  it('never throws on foreign/garbage events', () => {
    // Formstr encrypted template: only d/name/relay tags, ciphertext content
    const encrypted = evt(
      [
        ['d', 'cezpPW'],
        ['name', 'Event RSVP'],
        ['relay', 'wss://relay.damus.io/']
      ],
      'Ao1zaZrLE5…'
    );
    expect(parseFormTemplate(encrypted).fields).toEqual([]);
    // lotus dialect: JSON content, no settings/field tags
    const lotus = evt(
      [
        ['d', 'form-1'],
        ['title', 'Untitled form'],
        ['t', 'nostroogle-form'],
        ['client', 'lotus']
      ],
      '{"questions":[]}'
    );
    expect(parseFormTemplate(lotus).fields).toEqual([]);
    // malformed field tag JSON
    const broken = evt([
      ['d', 'b'],
      ['settings', 'not-json'],
      ['field', 'x', 'text', 'X', 'not-json', 'not-json']
    ]);
    const p = parseFormTemplate(broken);
    expect(p.fields[0].id).toBe('x');
    expect(p.fields[0].options).toEqual({});
  });

  it('generateOptionId slugifies and dedupes', () => {
    expect(generateOptionId('Red Colour!', [])).toBe('red-colour');
    expect(generateOptionId('Red Colour!', ['red-colour'])).toBe('red-colour-2');
    // empty slug falls back exactly like generateFieldId ('field-1' behavior)
    expect(generateOptionId('äöü', [])).toBe('option-1');
  });

  it('dedupes duplicate option ids in a select field (NIP-101 path), keeping first', () => {
    const broken = evt([
      ['d', 'b'],
      ['settings', '{}'],
      ['field', 'x', 'option', 'X', '[["x","X"],["x","X2"]]', '{"renderElement":"select"}']
    ]);
    const parsed = parseFormTemplate(broken);
    expect(parsed.fields[0].options?.options).toEqual([{ id: 'x', label: 'X' }]);
  });

  it('dedupes duplicate option ids in the legacy dialect', () => {
    const legacy = evt([
      ['d', 'old'],
      ['name', 'Old form'],
      ['field', 'role', 'radio', 'Role?', '', '{"options":["Teacher","Teacher"]}']
    ]);
    const parsed = parseFormTemplate(legacy);
    expect(parsed.fields[0].options?.options).toEqual([{ id: 'Teacher', label: 'Teacher' }]);
  });

  it('dedupes duplicate section ids in settings.sections, keeping first', () => {
    const broken = evt([
      ['d', 'b'],
      [
        'settings',
        JSON.stringify({
          sections: [
            { id: 's1', title: 'First', questionIds: [] },
            { id: 's1', title: 'Second', questionIds: [] }
          ]
        })
      ]
    ]);
    const parsed = parseFormTemplate(broken);
    expect(parsed.sections).toEqual([{ id: 's1', title: 'First', questionIds: [] }]);
  });

  it('dedupes duplicate field ids, keeping first', () => {
    const broken = evt([
      ['d', 'b'],
      ['settings', '{}'],
      ['field', 'dup', 'text', 'First', '', '{}'],
      ['field', 'dup', 'text', 'Second', '', '{}']
    ]);
    const parsed = parseFormTemplate(broken);
    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0].label).toBe('First');
  });

  it('drops non-object sections entries instead of throwing', () => {
    // The parser's contract is "never throws on garbage events" — a relay can
    // hand us settings.sections entries that are null or primitives.
    const broken = evt([
      ['d', 'g'],
      ['settings', JSON.stringify({ sections: [null, 'junk', 7, { id: 's1', title: 'Ok' }] })]
    ]);
    const parsed = parseFormTemplate(broken);
    expect(parsed.sections).toEqual([{ id: 's1', title: 'Ok' }]);
  });
});
