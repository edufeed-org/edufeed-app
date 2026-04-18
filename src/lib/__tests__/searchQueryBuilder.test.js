/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import {
  buildSearchQuery,
  buildSearchFilterObject,
  hasActiveFilters,
  createEmptyFilters
} from '../helpers/educational/searchQueryBuilder.js';

describe('buildSearchQuery (baseline)', () => {
  test('returns free-text search only', () => {
    expect(buildSearchQuery({ searchText: 'mathematik' })).toBe('mathematik');
  });

  test('joins text + AMB-core filters with spaces', () => {
    const q = buildSearchQuery({
      searchText: 'bildung',
      learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video', prefLabel: {} }]
    });
    expect(q).toContain('bildung');
    expect(q).toContain('learningResourceType.id:https://w3id.org/kim/hcrt/video');
  });
});

describe('buildSearchQuery extFields emission', () => {
  const extKey = '30168:aaa:amb-full:interactivityType';
  const pubkey = 'aaa';

  test('emits ext.*.id:<uri> for concept-valued ext fields', () => {
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    expect(q).toBe(
      `ext.30168.${pubkey}.amb-full.interactivityType.id:http://purl.org/dcx/lrmi-vocabs/interactivityType/active`
    );
  });

  test('emits ext.<path>:<value> for scalar ext fields', () => {
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{ value: 'foobar' }]
      }
    });
    expect(q).toBe(`ext.30168.${pubkey}.amb-full.interactivityType:foobar`);
  });

  test('preserves multiple concept values per field (OR semantics)', () => {
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{ id: 'http://example.org/a' }, { id: 'http://example.org/b' }]
      }
    });
    const parts = q.split(' ');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('http://example.org/a');
    expect(parts[1]).toContain('http://example.org/b');
  });

  test('escapes double quotes in ext values', () => {
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{ value: 'foo "bar"' }]
      }
    });
    expect(q).toContain('foo \\"bar\\"');
  });

  test('ignores entries with neither id nor value', () => {
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{}]
      }
    });
    expect(q).toBe('');
  });

  test('combines text + AMB-core + ext in one query', () => {
    const q = buildSearchQuery({
      searchText: 'oer',
      learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video', prefLabel: {} }],
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    expect(q).toContain('oer');
    expect(q).toContain('learningResourceType.id:https://w3id.org/kim/hcrt/video');
    expect(q).toContain(
      `ext.30168.${pubkey}.amb-full.interactivityType.id:http://purl.org/dcx/lrmi-vocabs/interactivityType/active`
    );
  });
});

describe('buildSearchFilterObject dual-emit', () => {
  const extKey = '30168:aaa:amb-full:interactivityType';

  test('returns { search, tagFilters } object', () => {
    const out = buildSearchFilterObject({
      searchText: 'bildung'
    });
    expect(out).toHaveProperty('search');
    expect(out).toHaveProperty('tagFilters');
    expect(out.search).toBe('bildung');
    expect(out.tagFilters).toEqual({});
  });

  test('dual-emits #ext:* tag filter for concept-valued ext fields', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    // search string uses dots (Typesense path)
    expect(out.search).toContain(
      'ext.30168.aaa.amb-full.interactivityType.id:http://purl.org/dcx/lrmi-vocabs/interactivityType/active'
    );
    // tag filter uses colons (matches event tag key from form-to-amb serializer)
    expect(out.tagFilters).toHaveProperty('#ext:30168:aaa:amb-full:interactivityType:id');
    expect(out.tagFilters['#ext:30168:aaa:amb-full:interactivityType:id']).toEqual([
      'http://purl.org/dcx/lrmi-vocabs/interactivityType/active'
    ]);
  });

  test('dual-emits #ext:* tag filter for scalar ext fields', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ value: 'foo' }]
      }
    });
    expect(out.tagFilters).toHaveProperty('#ext:30168:aaa:amb-full:interactivityType');
    expect(out.tagFilters['#ext:30168:aaa:amb-full:interactivityType']).toEqual(['foo']);
  });

  test('groups multiple values under one filter key (OR semantics)', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ id: 'http://example.org/a' }, { id: 'http://example.org/b' }]
      }
    });
    expect(out.tagFilters['#ext:30168:aaa:amb-full:interactivityType:id']).toEqual([
      'http://example.org/a',
      'http://example.org/b'
    ]);
  });
});

describe('hasActiveFilters', () => {
  test('is true when extFields is set', () => {
    expect(
      hasActiveFilters({
        extFields: { 'some:key': [{ id: 'x' }] }
      })
    ).toBe(true);
  });

  test('is false for extFields with no values', () => {
    expect(
      hasActiveFilters({
        extFields: {}
      })
    ).toBe(false);
  });

  test('is false for extFields with empty arrays', () => {
    expect(
      hasActiveFilters({
        extFields: { 'some:key': [] }
      })
    ).toBe(false);
  });

  test('is false on empty filters', () => {
    expect(hasActiveFilters(createEmptyFilters())).toBe(false);
  });
});
