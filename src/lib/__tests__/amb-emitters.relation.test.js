/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';

/** @param {string[][]} tags */
const evt = (tags) =>
  /** @type {any} */ ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('relation emitter (NIP-AMB a-tags)', () => {
  const field = /** @type {any} */ ({
    id: 'parts',
    type: 'amb-relation',
    output: 'amb:hasPart',
    options: {}
  });
  const ctx = /** @type {any} */ ({
    field,
    prop: 'hasPart',
    formDTag: 'amb-basic',
    defaultLang: 'de'
  });
  it('emits a-tag per related 30142 coordinate with the AMB role', () => {
    const value = [
      { coordinate: '30142:abc:res1', relayHint: 'wss://r' },
      { coordinate: '30142:def:res2' }
    ];
    expect(resolveEmitter(field).emit(value, ctx)).toEqual([
      ['a', '30142:abc:res1', 'wss://r', 'hasPart'],
      ['a', '30142:def:res2', '', 'hasPart']
    ]);
  });
  it('parses a-tags of the right role back to refs', () => {
    const parsed = resolveEmitter(field).parse(
      evt([
        ['a', '30142:abc:res1', 'wss://r', 'hasPart'],
        ['a', '30142:def:res2', '', 'isPartOf']
      ]),
      ctx
    );
    expect(parsed.value).toEqual([{ coordinate: '30142:abc:res1', relayHint: 'wss://r' }]);
  });
});
