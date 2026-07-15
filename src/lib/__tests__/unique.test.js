/**
 * Dedupe helpers for keyed {#each} blocks.
 *
 * Data extracted from Nostr event tags is untrusted network input — a
 * malformed event can repeat any tag, and a duplicate key in a keyed
 * {#each} crashes the whole page (each_key_duplicate). These helpers are
 * the standard boundary between tag extraction and keyed rendering.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import { unique, uniqueBy } from '$lib/helpers/unique.js';

describe('unique', () => {
  it('removes duplicates while preserving first-seen order', () => {
    expect(unique(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array even when there are no duplicates', () => {
    const input = ['x', 'y'];
    const out = unique(input);
    expect(out).toEqual(['x', 'y']);
    expect(out).not.toBe(input);
  });

  it('handles empty and nullish input', () => {
    expect(unique([])).toEqual([]);
    expect(unique(undefined)).toEqual([]);
    expect(unique(null)).toEqual([]);
  });
});

describe('uniqueBy', () => {
  it('keeps the first item for each key, preserving order', () => {
    const items = [
      { pubkey: 'aa', n: 1 },
      { pubkey: 'bb', n: 2 },
      { pubkey: 'aa', n: 3 }
    ];
    expect(uniqueBy(items, (i) => i.pubkey)).toEqual([
      { pubkey: 'aa', n: 1 },
      { pubkey: 'bb', n: 2 }
    ]);
  });

  it('handles empty and nullish input', () => {
    expect(uniqueBy([], (i) => i)).toEqual([]);
    expect(uniqueBy(undefined, (i) => i)).toEqual([]);
  });
});
