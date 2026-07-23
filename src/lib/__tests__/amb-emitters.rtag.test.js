/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveEmitter } from '$lib/helpers/forms/amb-emitters.js';
const field = /** @type {any} */ ({
  id: 'refs',
  type: 'external-urls',
  output: 'amb:refs',
  options: {}
});
const ctx = /** @type {any} */ ({ field, prop: 'refs', formDTag: 'amb-basic', defaultLang: 'de' });
/** @param {string[][]} tags */
const evt = (tags) =>
  /** @type {any} */ ({ kind: 30142, pubkey: 'pk', content: '', created_at: 0, tags });

describe('r-tag emitter', () => {
  it('emits r tags and parses them back', () => {
    const em = resolveEmitter(field);
    expect(em.emit(['https://a.example', 'https://doi.org/10.1/x'], ctx)).toEqual([
      ['r', 'https://a.example'],
      ['r', 'https://doi.org/10.1/x']
    ]);
    expect(em.parse(evt([['r', 'https://a.example']]), ctx).value).toEqual(['https://a.example']);
  });
});
