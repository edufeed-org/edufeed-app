/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseFormTemplate } from '$lib/helpers/forms.js';

// Shape from the NIP-101 spec example (abh3po/nips nostr-form branch)
const nip101SpecExample = {
  kind: 30168,
  pubkey: 'author',
  content: '',
  created_at: 0,
  tags: [
    ['d', 'spec-form'],
    ['name', 'Name of the form'],
    ['settings', JSON.stringify({ description: 'description of the form.' })],
    ['field', 'aX1', 'text', 'What is your age?', '[]', JSON.stringify({ required: true })],
    [
      'field',
      'bY2',
      'option',
      'Favourite drink?',
      JSON.stringify([
        ['o1', 'Coffee'],
        ['o2', 'Tea']
      ]),
      '{}'
    ]
  ]
};

describe('NIP-101 interop', () => {
  it('parses the NIP-101 spec example', () => {
    const p = parseFormTemplate(nip101SpecExample);
    expect(p.name).toBe('Name of the form');
    expect(p.description).toBe('description of the form.');
    expect(p.fields).toHaveLength(2);
    expect(p.fields[0].type).toBe('text'); // no renderElement → inputType fallback
    expect(p.fields[0].options?.required).toBe(true);
    expect(p.fields[1].type).toBe('select'); // option → select fallback
    expect(p.fields[1].options?.options).toEqual([
      { id: 'o1', label: 'Coffee' },
      { id: 'o2', label: 'Tea' }
    ]);
  });

  it('tolerates a real encrypted Formstr template (captured 2026-07-16 from relay.damus.io)', () => {
    const encrypted = {
      kind: 30168,
      pubkey: '671e8d7b0000000000000000000000000000000000000000000000000000abcd',
      content: 'Ao1zaZrLE5SJZ8w54pcLNIGlN7PqM8CMAJqmV6EX65C9HMVJHaGgBmPLaVXn8Jo2',
      created_at: 1784201148,
      tags: [
        ['d', 'cezpPW'],
        ['name', 'Event RSVP'],
        ['relay', 'wss://relay.damus.io/'],
        ['relay', 'wss://nos.lol']
      ]
    };
    const p = parseFormTemplate(encrypted);
    expect(p.name).toBe('Event RSVP');
    expect(p.fields).toEqual([]); // fields are in encrypted content we don't support — degrade, don't crash
  });

  it('tolerates the lotus/nostroogle JSON dialect', () => {
    const lotus = {
      kind: 30168,
      pubkey: '7ea54f890000000000000000000000000000000000000000000000000000abcd',
      content: JSON.stringify({ id: 'form-x', title: 'Untitled form', questions: [] }),
      created_at: 1784188079,
      tags: [
        ['d', 'form-x'],
        ['title', 'Untitled form'],
        ['t', 'nostroogle-form'],
        ['client', 'lotus']
      ]
    };
    expect(() => parseFormTemplate(lotus)).not.toThrow();
    expect(parseFormTemplate(lotus).fields).toEqual([]);
  });
});
