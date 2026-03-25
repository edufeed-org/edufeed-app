/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  buildFormTemplateTags,
  parseFormTemplate,
  generateFieldId,
  validateField,
  buildResponseTags,
  parseResponseTags,
  formCoordinateToNaddr,
  formEventToNaddr
} from '../helpers/forms.js';

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

describe('forms — field validation', () => {
  it('required field with empty value fails', () => {
    const field = { id: 'name', type: 'text', label: 'Name', options: { required: true } };
    expect(validateField(field, '')).toBe('Name is required');
  });

  it('required field with value passes', () => {
    const field = { id: 'name', type: 'text', label: 'Name', options: { required: true } };
    expect(validateField(field, 'Bob')).toBeNull();
  });

  it('optional field with empty value passes', () => {
    const field = { id: 'name', type: 'text', label: 'Name', options: {} };
    expect(validateField(field, '')).toBeNull();
  });

  it('textarea min length check', () => {
    const field = {
      id: 'reason',
      type: 'textarea',
      label: 'Reason',
      options: { required: true, min: 10 }
    };
    expect(validateField(field, 'short')).toBe('Reason must be at least 10 characters');
    expect(validateField(field, 'this is long enough')).toBeNull();
  });

  it('textarea max length check', () => {
    const field = { id: 'bio', type: 'textarea', label: 'Bio', options: { max: 5 } };
    expect(validateField(field, 'toolong')).toBe('Bio must be at most 5 characters');
  });

  it('number min/max check', () => {
    const field = { id: 'age', type: 'number', label: 'Age', options: { min: 18, max: 120 } };
    expect(validateField(field, '17')).toBe('Age must be at least 18');
    expect(validateField(field, '121')).toBe('Age must be at most 120');
    expect(validateField(field, '25')).toBeNull();
  });

  it('email format check', () => {
    const field = { id: 'email', type: 'email', label: 'Email', options: { required: true } };
    expect(validateField(field, 'notanemail')).toBe('Email must be a valid email address');
    expect(validateField(field, 'user@example.com')).toBeNull();
  });

  it('url format check', () => {
    const field = { id: 'website', type: 'url', label: 'Website', options: { required: true } };
    expect(validateField(field, 'notaurl')).toBe('Website must be a valid URL');
    expect(validateField(field, 'https://example.com')).toBeNull();
  });

  it('checkbox required must be true', () => {
    const field = { id: 'terms', type: 'checkbox', label: 'Terms', options: { required: true } };
    expect(validateField(field, 'false')).toBe('Terms is required');
    expect(validateField(field, 'true')).toBeNull();
  });

  it('select required must have value', () => {
    const field = { id: 'tier', type: 'select', label: 'Tier', options: { required: true } };
    expect(validateField(field, '')).toBe('Tier is required');
    expect(validateField(field, 'Premium')).toBeNull();
  });
});

describe('forms — response tags', () => {
  it('builds response tags from field values', () => {
    const values = { 'full-name': 'Bob', reason: 'I want in' };
    const tags = buildResponseTags(values);
    expect(tags).toContainEqual(['response', 'full-name', 'Bob']);
    expect(tags).toContainEqual(['response', 'reason', 'I want in']);
  });

  it('parses response tags back to values', () => {
    const tags = [
      ['response', 'full-name', 'Bob'],
      ['response', 'reason', 'I want in']
    ];
    const values = parseResponseTags(tags);
    expect(values).toEqual({ 'full-name': 'Bob', reason: 'I want in' });
  });
});

describe('forms — coordinate conversion', () => {
  it('converts form coordinate to naddr', () => {
    const naddr = formCoordinateToNaddr(
      '30168:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:my-form',
      ['wss://relay.example.com']
    );
    expect(naddr).toMatch(/^naddr1/);
  });

  it('throws on invalid coordinate format', () => {
    expect(() => formCoordinateToNaddr('invalid', [])).toThrow();
  });
});

describe('forms — event to naddr', () => {
  it('converts a form event to naddr', () => {
    const event = {
      kind: 30168,
      pubkey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      tags: [['d', 'my-form']],
      content: '',
      created_at: 1
    };
    const naddr = formEventToNaddr(event, ['wss://relay.example.com']);
    expect(naddr).toMatch(/^naddr1/);
  });
});
