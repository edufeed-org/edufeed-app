/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', async () => {
  const { EventFactory } = await import('applesauce-core/event-factory');
  return {
    createAppEventFactory: vi.fn((/** @type {any} */ opts) => new EventFactory(opts))
  };
});

import { buildFormTemplateTags, parseFormTemplate } from '../helpers/forms.js';

describe('forms.js: field-vocab and field-output tag round-trip', () => {
  it('emits and parses a field-vocab tag for a vocab-bound field', () => {
    const fields = [
      {
        id: 'about',
        type: 'select',
        label: 'Fach',
        vocab: { address: '39737:pub:schulfaecher', relay: 'wss://r.example' },
        output: 'amb:about'
      }
    ];
    const tags = buildFormTemplateTags('amb-basic', fields, { name: 'AMB Basic' });
    expect(tags).toContainEqual([
      'field-vocab',
      'about',
      'a',
      '39737:pub:schulfaecher',
      'wss://r.example'
    ]);
    expect(tags).toContainEqual(['field-output', 'about', 'amb:about']);

    const parsed = parseFormTemplate({
      tags,
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0
    });
    expect(parsed.fields[0].vocab).toEqual({
      address: '39737:pub:schulfaecher',
      relay: 'wss://r.example'
    });
    expect(parsed.fields[0].output).toBe('amb:about');
  });

  it('parses a field with field-output "ext" (no vocab)', () => {
    const fields = [{ id: 'klassenstufe', type: 'number', label: 'Klassenstufe', output: 'ext' }];
    const tags = buildFormTemplateTags('x', fields, {});
    expect(tags).toContainEqual(['field-output', 'klassenstufe', 'ext']);

    const parsed = parseFormTemplate({
      tags,
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0
    });
    expect(parsed.fields[0].output).toBe('ext');
    expect(parsed.fields[0].vocab).toBeUndefined();
  });

  it('defaults output to "amb:<fieldId>" when no field-output tag is present', () => {
    const tags = buildFormTemplateTags('x', [{ id: 'name', type: 'text', label: 'Name' }], {});
    expect(tags.some((t) => t[0] === 'field-output')).toBe(false);

    const parsed = parseFormTemplate({
      tags,
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0
    });
    expect(parsed.fields[0].output).toBe('amb:name');
  });

  it('emits and parses an ["a", 30168:..., relay, "forkOf"] tag', () => {
    const forkOf = { address: '30168:parentPub:amb-full', relay: 'wss://r.example' };
    const tags = buildFormTemplateTags('amb-full-fork', [], { name: 'Fork', forkOf });
    expect(tags).toContainEqual(['a', '30168:parentPub:amb-full', 'wss://r.example', 'forkOf']);

    const parsed = parseFormTemplate({
      tags,
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0
    });
    expect(parsed.forkOf).toEqual({
      address: '30168:parentPub:amb-full',
      relay: 'wss://r.example'
    });
  });

  it('omits forkOf when no parent is provided; parsed forkOf is undefined', () => {
    const tags = buildFormTemplateTags('plain', [], {});
    expect(tags.some((t) => t[0] === 'a' && t[3] === 'forkOf')).toBe(false);

    const parsed = parseFormTemplate({
      tags,
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0
    });
    expect(parsed.forkOf).toBeUndefined();
  });

  it('first field-vocab and field-output win when duplicates are present', () => {
    const parsed = parseFormTemplate({
      kind: 30168,
      pubkey: 'p',
      content: '',
      created_at: 0,
      tags: [
        ['d', 'x'],
        ['field', 'about', 'select', 'Fach', '', '{}'],
        ['field-vocab', 'about', 'a', '39737:pub:v1', 'wss://r'],
        ['field-vocab', 'about', 'a', '39737:pub:v2', 'wss://r'],
        ['field-output', 'about', 'amb:about'],
        ['field-output', 'about', 'ext']
      ]
    });
    expect(parsed.fields[0].vocab?.address).toBe('39737:pub:v1');
    expect(parsed.fields[0].output).toBe('amb:about');
  });
});
