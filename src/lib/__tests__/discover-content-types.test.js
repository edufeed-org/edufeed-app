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
    expect(parseDiscoverContentTypes(['people', 'events', 'events', 'bogus', 'learning'])).toEqual([
      'events',
      'learning',
      'people'
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
    expect(getDiscoverTabs(['events', 'learning', 'people'])).toEqual([
      'all',
      'events',
      'learning',
      'people'
    ]);
  });

  it('omits "all" when fewer than two feed types are enabled', () => {
    expect(getDiscoverTabs(['events', 'communities', 'people'])).toEqual([
      'events',
      'communities',
      'people'
    ]);
    expect(getDiscoverTabs(['communities', 'people'])).toEqual(['communities', 'people']);
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
    expect(resolveDiscoverType('all', ['communities', 'people'])).toBe('communities');
  });
});

describe('isDiscoverTypeEnabled', () => {
  it('checks membership in the enabled list', () => {
    expect(isDiscoverTypeEnabled('events', ['events'])).toBe(true);
    expect(isDiscoverTypeEnabled('people', ['events'])).toBe(false);
  });
});
