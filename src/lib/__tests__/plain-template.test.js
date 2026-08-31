/** @vitest-environment node */
// plainTemplate must hand a signer a structured-cloneable template. A community
// 10222 lives in Svelte $state, so its tag entries are deep reactive proxies. A
// NIP-07 extension signer serialises via window.postMessage → structuredClone,
// which throws DataCloneError on a Svelte proxy. Regression guard for the live
// bug (laoc 2026-08-20: "flip to moderated / saving basics failed DataCloneError
// ... postMessage").
import { describe, it, expect } from 'vitest';
import { plainTemplate } from '$lib/helpers/plain-template.js';

// A stand-in for a Svelte $state deep proxy: a Proxy whose get trap makes
// structuredClone (and thus postMessage) throw, exactly like the runtime one.
/** @param {string[]} arr */
function reactiveTag(arr) {
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === Symbol.for('svelte-proxy')) return true;
      return Reflect.get(target, prop, receiver);
    }
  });
}

describe('plainTemplate', () => {
  it('de-proxies reactive tags into a structured-cloneable template', () => {
    const template = {
      kind: 10222,
      content: '',
      created_at: 100,
      tags: [
        reactiveTag(['d', 'edufeed']),
        reactiveTag(['name', 'My Community']),
        reactiveTag(['membership', 'root1', 'wss://groups.edufeed.org'])
      ]
    };

    // Pre-condition: the raw template is NOT cloneable (proves the bug is real).
    expect(() => structuredClone(template)).toThrow();

    const plain = plainTemplate(template);
    expect(() => structuredClone(plain)).not.toThrow();
    expect(plain.tags).toEqual(template.tags.map((t) => [...t]));
    // Non-tag fields are preserved verbatim.
    expect(plain.kind).toBe(10222);
    expect(plain.created_at).toBe(100);
    expect(plain.content).toBe('');
  });

  it('round-trips an already-plain template unchanged', () => {
    const template = {
      kind: 30000,
      content: '',
      created_at: 1,
      tags: [
        ['d', 'x'],
        ['form', 'f']
      ]
    };
    const plain = plainTemplate(template);
    expect(plain.tags).toEqual([
      ['d', 'x'],
      ['form', 'f']
    ]);
    expect(() => structuredClone(plain)).not.toThrow();
  });

  it('passes a non-array tags value through untouched', () => {
    expect(plainTemplate({ kind: 1, tags: undefined }).tags).toBeUndefined();
    expect(plainTemplate({ kind: 1 }).tags).toBeUndefined();
  });
});
