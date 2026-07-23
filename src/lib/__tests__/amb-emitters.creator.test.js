/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

const field = /** @type {any} */ ({
  id: 'creators',
  type: 'creator',
  output: 'amb:creator',
  options: {}
});
const ctx = /** @type {any} */ ({
  field,
  prop: 'creator',
  formDTag: 'amb-basic',
  defaultLang: 'de'
});
/** @param {string[][]} tags */
const evt = (tags) =>
  /** @type {any} */ ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('creator emitter (NIP-AMB)', () => {
  it('nostr-identity creator → p-tag only', () => {
    const value = [{ name: 'Alice', type: 'Person', pubkey: 'abc123', relayHint: 'wss://r' }];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([['p', 'abc123', 'wss://r', 'creator']]);
  });
  it('external creator → creator:* flattened (name, type, honorific, orcid, affiliation)', () => {
    const value = [
      {
        name: 'Prof. John Doe',
        type: 'Person',
        honorificPrefix: 'Prof.',
        orcid: 'https://orcid.org/0000-0009-8765-4321',
        affiliationName: 'Stanford University'
      }
    ];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([
      ['creator:id', 'https://orcid.org/0000-0009-8765-4321'],
      ['creator:name', 'Prof. John Doe'],
      ['creator:type', 'Person'],
      ['creator:honorificPrefix', 'Prof.'],
      ['creator:affiliation:name', 'Stanford University'],
      ['creator:affiliation:type', 'Organization']
    ]);
  });
  it('parses p-tag and flattened creators back', () => {
    const parsed = resolveEmitter(field).parse(
      evt([
        ['p', 'abc123', 'wss://r', 'creator'],
        ['creator:name', 'Jane'],
        ['creator:type', 'Organization']
      ]),
      ctx
    );
    expect(parsed.value).toEqual([
      { name: '', type: 'Person', pubkey: 'abc123', relayHint: 'wss://r' },
      { name: 'Jane', type: 'Organization' }
    ]);
  });
});
