/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  topEventPublishers,
  filterEventsByPublisherSelection
} from '$lib/helpers/topPublishers.js';

/** @param {string} pubkey */
const ev = (pubkey) => ({ pubkey });

describe('topEventPublishers', () => {
  it('counts events per author and sorts by count descending', () => {
    const events = [ev('a'), ev('b'), ev('a'), ev('c'), ev('a'), ev('b')];
    expect(topEventPublishers(events)).toEqual([
      { pubkey: 'a', count: 3 },
      { pubkey: 'b', count: 2 },
      { pubkey: 'c', count: 1 }
    ]);
  });

  it('limits the result to the requested size', () => {
    const events = [ev('a'), ev('a'), ev('b'), ev('c')];
    expect(topEventPublishers(events, 2)).toEqual([
      { pubkey: 'a', count: 2 },
      { pubkey: 'b', count: 1 }
    ]);
  });

  it('breaks count ties by first appearance for stable chip order', () => {
    const events = [ev('x'), ev('y'), ev('y'), ev('x')];
    expect(topEventPublishers(events)).toEqual([
      { pubkey: 'x', count: 2 },
      { pubkey: 'y', count: 2 }
    ]);
  });

  it('handles empty input and events without pubkey', () => {
    expect(topEventPublishers([])).toEqual([]);
    expect(topEventPublishers([{}, { pubkey: '' }])).toEqual([]);
  });
});

describe('filterEventsByPublisherSelection', () => {
  const events = [{ pubkey: 'a' }, { pubkey: 'b' }, { pubkey: 'c' }];

  it('returns only the solo author when solo is set (hidden ignored)', () => {
    expect(filterEventsByPublisherSelection(events, { solo: 'b', hidden: ['b', 'c'] })).toEqual([
      { pubkey: 'b' }
    ]);
  });

  it('removes hidden authors when no solo is set', () => {
    expect(filterEventsByPublisherSelection(events, { solo: null, hidden: ['a'] })).toEqual([
      { pubkey: 'b' },
      { pubkey: 'c' }
    ]);
  });

  it('returns the input array unchanged when nothing is selected', () => {
    expect(filterEventsByPublisherSelection(events, { solo: null, hidden: [] })).toBe(events);
  });
});
