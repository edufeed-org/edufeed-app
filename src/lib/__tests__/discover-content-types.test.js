/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  DISCOVER_CONTENT_TYPES,
  DISCOVER_FEED_TYPES,
  parseDiscoverContentTypes,
  getDiscoverTabs,
  resolveDiscoverType,
  isDiscoverTypeEnabled
} from '$lib/helpers/discover-content-types.js';

describe('parseDiscoverContentTypes', () => {
  it('returns every content type in canonical order when unset', () => {
    expect(parseDiscoverContentTypes(undefined)).toEqual(DISCOVER_CONTENT_TYPES);
    expect(parseDiscoverContentTypes([])).toEqual(DISCOVER_CONTENT_TYPES);
  });

  it('keeps only known types, deduped, in canonical order', () => {
    expect(parseDiscoverContentTypes(['events', 'people', 'events', 'bogus', 'learning'])).toEqual([
      'people',
      'events',
      'learning'
    ]);
  });

  it('orders the canonical tabs people first, then the feed types, then communities', () => {
    expect(DISCOVER_CONTENT_TYPES).toEqual([
      'people',
      'events',
      'learning',
      'articles',
      'boards',
      'communities'
    ]);
  });

  it('accepts a comma-separated string with whitespace and mixed case', () => {
    expect(parseDiscoverContentTypes(' Articles, boards ')).toEqual(['articles', 'boards']);
  });

  it('falls back to every type when nothing valid remains', () => {
    expect(parseDiscoverContentTypes(['bogus'])).toEqual(DISCOVER_CONTENT_TYPES);
  });

  it('never returns the synthetic "all" tab as a content type', () => {
    expect(parseDiscoverContentTypes(['all', 'events'])).toEqual(['events']);
  });
});

describe('getDiscoverTabs', () => {
  it('prepends "all" when at least two feed types are enabled', () => {
    expect(getDiscoverTabs(['people', 'events', 'learning'])).toEqual([
      'all',
      'people',
      'events',
      'learning'
    ]);
  });

  it('renders Alle · Personen · Veranstaltungen · Lernmaterialien · Artikel · Boards · Communities by default', () => {
    expect(getDiscoverTabs(parseDiscoverContentTypes(undefined))).toEqual([
      'all',
      'people',
      'events',
      'learning',
      'articles',
      'boards',
      'communities'
    ]);
  });

  it('omits "all" when fewer than two feed types are enabled', () => {
    expect(getDiscoverTabs(['people', 'events', 'communities'])).toEqual([
      'people',
      'events',
      'communities'
    ]);
    expect(getDiscoverTabs(['people', 'communities'])).toEqual(['people', 'communities']);
    expect(getDiscoverTabs(['learning'])).toEqual(['learning']);
  });

  it('feed types are the ones merged into "all"', () => {
    expect(DISCOVER_FEED_TYPES).toEqual(['events', 'learning', 'articles', 'boards']);
  });
});

describe('resolveDiscoverType', () => {
  const tabs = ['all', 'events', 'learning'];

  it('keeps a requested type that is enabled', () => {
    expect(resolveDiscoverType('learning', tabs)).toBe('learning');
  });

  it('falls back to the first tab for missing, unknown or disabled types', () => {
    expect(resolveDiscoverType(null, tabs)).toBe('all');
    expect(resolveDiscoverType('', tabs)).toBe('all');
    expect(resolveDiscoverType('nope', tabs)).toBe('all');
    expect(resolveDiscoverType('boards', tabs)).toBe('all');
    expect(resolveDiscoverType('all', ['people', 'communities'])).toBe('communities');
  });

  it('never defaults to the people tab when another tab exists', () => {
    // Personen is listed early but is a search UI, not a feed — landing on it
    // would show an empty hint instead of content.
    expect(resolveDiscoverType(null, ['people', 'events'])).toBe('events');
    expect(resolveDiscoverType(null, ['people'])).toBe('people');
    expect(resolveDiscoverType('people', ['people', 'events'])).toBe('people');
  });
});

describe('isDiscoverTypeEnabled', () => {
  it('checks membership in the enabled list', () => {
    expect(isDiscoverTypeEnabled('events', ['events'])).toBe(true);
    expect(isDiscoverTypeEnabled('people', ['events'])).toBe(false);
  });
});
