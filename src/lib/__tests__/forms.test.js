/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildFormTemplateTags, parseFormTemplate, generateFieldId } from '../helpers/forms.js';

describe('forms — tag building', () => {
  it('builds minimal form template tags', () => {
    const tags = buildFormTemplateTags('my-form', [], {});
    expect(tags).toContainEqual(['d', 'my-form']);
  });

  it('builds tags with name and description', () => {
    const tags = buildFormTemplateTags('my-form', [], {
      name: 'My Form',
      description: 'A test form'
    });
    expect(tags).toContainEqual(['name', 'My Form']);
    expect(tags).toContainEqual(['description', 'A test form']);
  });

  it('builds field tags with correct format', () => {
    const fields = [
      {
        id: 'full-name',
        type: 'text',
        label: 'Full Name',
        defaultValue: '',
        options: { required: true }
      }
    ];
    const tags = buildFormTemplateTags('my-form', fields, {});
    expect(tags).toContainEqual([
      'field',
      'full-name',
      'text',
      'Full Name',
      '',
      '{"required":true}'
    ]);
  });

  it('includes public tag when specified', () => {
    const tags = buildFormTemplateTags('my-form', [], { public: true });
    expect(tags).toContainEqual(['public']);
  });

  it('includes confirmation_message tag', () => {
    const tags = buildFormTemplateTags('my-form', [], { confirmationMessage: 'Thanks!' });
    expect(tags).toContainEqual(['confirmation_message', 'Thanks!']);
  });

  it('omits optional tags when not provided', () => {
    const tags = buildFormTemplateTags('my-form', [], {});
    expect(tags.find((t) => t[0] === 'name')).toBeUndefined();
    expect(tags.find((t) => t[0] === 'public')).toBeUndefined();
    expect(tags.find((t) => t[0] === 'confirmation_message')).toBeUndefined();
  });
});

describe('forms — template parsing', () => {
  it('parses form template event into structured data', () => {
    const event = {
      kind: 30168,
      pubkey: 'abc',
      tags: [
        ['d', 'my-form'],
        ['name', 'My Form'],
        ['description', 'A test form'],
        ['field', 'full-name', 'text', 'Full Name', '', '{"required":true}'],
        ['field', 'reason', 'textarea', 'Why?', '', '{"required":true,"min":50}'],
        ['confirmation_message', 'Thanks!']
      ],
      content: '',
      created_at: 1700000000
    };
    const parsed = parseFormTemplate(event);
    expect(parsed.dTag).toBe('my-form');
    expect(parsed.name).toBe('My Form');
    expect(parsed.description).toBe('A test form');
    expect(parsed.confirmationMessage).toBe('Thanks!');
    expect(parsed.isPublic).toBe(false);
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0]).toEqual({
      id: 'full-name',
      type: 'text',
      label: 'Full Name',
      defaultValue: '',
      options: { required: true }
    });
    expect(/** @type {any} */ (parsed.fields[1]).options.min).toBe(50);
  });

  it('detects public forms', () => {
    const event = {
      kind: 30168,
      pubkey: 'abc',
      content: '',
      created_at: 1,
      tags: [['d', 'f'], ['public']]
    };
    expect(parseFormTemplate(event).isPublic).toBe(true);
  });

  it('handles missing optional tags', () => {
    const event = {
      kind: 30168,
      pubkey: 'abc',
      content: '',
      created_at: 1,
      tags: [['d', 'f']]
    };
    const parsed = parseFormTemplate(event);
    expect(parsed.name).toBe('');
    expect(parsed.description).toBe('');
    expect(parsed.fields).toHaveLength(0);
    expect(parsed.confirmationMessage).toBe('');
  });

  it('handles malformed field options JSON gracefully', () => {
    const event = {
      kind: 30168,
      pubkey: 'abc',
      content: '',
      created_at: 1,
      tags: [
        ['d', 'f'],
        ['field', 'name', 'text', 'Name', '', 'not-json']
      ]
    };
    const parsed = parseFormTemplate(event);
    expect(parsed.fields[0].options).toEqual({});
  });
});

describe('forms — field ID generation', () => {
  it('slugifies label', () => {
    expect(generateFieldId('Full Name', [])).toBe('full-name');
  });

  it('handles special characters', () => {
    expect(generateFieldId('Email (optional)', [])).toBe('email-optional');
  });

  it('deduplicates with numeric suffix', () => {
    expect(generateFieldId('Name', ['name'])).toBe('name-2');
    expect(generateFieldId('Name', ['name', 'name-2'])).toBe('name-3');
  });

  it('handles empty label', () => {
    expect(generateFieldId('', [])).toBe('field-1');
  });
});
