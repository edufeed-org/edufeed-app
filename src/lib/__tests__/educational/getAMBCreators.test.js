/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getAMBCreators } from '$lib/helpers/educational/ambHelpers.js';

/** @param {string[][]} tags */
const ev = (tags) => ({ kind: 30142, tags, content: '', pubkey: 'pk' });

describe('getAMBCreators', () => {
  it('parses a single creator with all fields', () => {
    const event = ev([
      ['d', 'r1'],
      ['creator:type', 'Person'],
      ['creator:name', 'Ada Lovelace'],
      ['creator:honorificPrefix', 'Dr.'],
      ['creator:affiliation:name', 'Analytical Engines Inc.'],
      ['creator:id', 'https://orcid.org/0000-0002-1825-0097']
    ]);
    expect(getAMBCreators(event)).toEqual([
      {
        type: 'Person',
        name: 'Ada Lovelace',
        honorificPrefix: 'Dr.',
        affiliationName: 'Analytical Engines Inc.',
        id: 'https://orcid.org/0000-0002-1825-0097'
      }
    ]);
  });

  it('splits consecutive runs into separate creators (heterogeneous optional fields)', () => {
    // creator 1 has no ORCID, creator 2 does — positional grouping by key
    // would misattribute the single creator:id to creator 1; run-based
    // grouping must not.
    const event = ev([
      ['creator:type', 'Person'],
      ['creator:name', 'No Orcid'],
      ['creator:type', 'Person'],
      ['creator:name', 'Has Orcid'],
      ['creator:id', 'https://orcid.org/0000-0002-1694-233X']
    ]);
    expect(getAMBCreators(event)).toEqual([
      { type: 'Person', name: 'No Orcid' },
      { type: 'Person', name: 'Has Orcid', id: 'https://orcid.org/0000-0002-1694-233X' }
    ]);
  });

  it('starts a new creator when a field repeats even without type tag', () => {
    const event = ev([
      ['creator:name', 'One'],
      ['creator:name', 'Two']
    ]);
    expect(getAMBCreators(event)).toEqual([{ name: 'One' }, { name: 'Two' }]);
  });

  it('returns [] when there are no creator tags', () => {
    expect(getAMBCreators(ev([['d', 'r1']]))).toEqual([]);
    expect(getAMBCreators({})).toEqual([]);
  });

  it('defaults missing type to undefined and ignores unknown creator subkeys gracefully', () => {
    const event = ev([
      ['creator:name', 'X'],
      ['creator:somefuture:key', 'val']
    ]);
    expect(getAMBCreators(event)).toEqual([{ name: 'X' }]);
  });
});
