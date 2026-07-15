/**
 * Creator-name extraction from flattened `creator:*` tags.
 *
 * Regression: events in the wild carry the same creator run twice
 * (duplicate `creator:name`/`creator:type` pairs). `creatorNames` feeds a
 * keyed `{#each}` in AMBResourceView, so duplicates crash the page with
 * Svelte's each_key_duplicate error.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';

import { getAMBCreatorNames } from '$lib/helpers/educational/ambHelpers.js';

/** @param {string[][]} tags */
const eventWith = (tags) => ({ kind: 30142, tags });

describe('getAMBCreatorNames', () => {
  it('returns distinct creator names in tag order', () => {
    const event = eventWith([
      ['creator:name', 'Alice'],
      ['creator:type', 'Person'],
      ['creator:name', 'Bob'],
      ['creator:type', 'Person']
    ]);
    expect(getAMBCreatorNames(event)).toEqual(['Alice', 'Bob']);
  });

  it('dedupes repeated creator names (duplicate creator runs in the event)', () => {
    const event = eventWith([
      ['creator:name', 'Corinna Link'],
      ['creator:type', 'Person'],
      ['creator:name', 'Corinna Link'],
      ['creator:type', 'Person']
    ]);
    expect(getAMBCreatorNames(event)).toEqual(['Corinna Link']);
  });

  it('returns an empty array when no creator:name tags exist', () => {
    expect(getAMBCreatorNames(eventWith([['d', 'x']]))).toEqual([]);
  });
});
