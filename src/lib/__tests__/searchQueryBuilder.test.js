/** @vitest-environment node */
import { identifierFromAddress } from 'nostr-vocab-core/identifiers';
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
  // A form-driven ext field serializes to `ext:<form.dTag>:<field.id>`
  // (formValuesToAmbJson.js: amb.ext[form.dTag][field.id]), so the filter key
  // is "<ns>:<facet>". The pre-migration key carried the kind and the author
  // pubkey as well — see the "rejects" cases below.
  const extKey = 'amb-full:interactivityType';

  test('does not put ext facets in the NIP-50 search string at all', () => {
    // The dot path was removed rather than repaired: with reverse-DNS
    // namespaces there is no way to tell where <ns> ends and <facet> begins.
    const q = buildSearchQuery({
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    expect(q).toBe('');
  });

  test('AMB-core filters are unaffected by ext facets being present', () => {
    const q = buildSearchQuery({
      searchText: 'oer',
      learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video', prefLabel: {} }],
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    expect(q).toBe('oer learningResourceType.id:https://w3id.org/kim/hcrt/video');
  });
});

describe('buildSearchFilterObject dual-emit', () => {
  const extKey = 'amb-full:interactivityType';

  test('returns { search, tagFilters } object', () => {
    const out = buildSearchFilterObject({
      searchText: 'bildung'
    });
    expect(out).toHaveProperty('search');
    expect(out).toHaveProperty('tagFilters');
    expect(out.search).toBe('bildung');
    expect(out.tagFilters).toEqual({});
  });

  test('emits #ext:<ns>:<facet>:id for concept-valued ext fields', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ id: 'http://purl.org/dcx/lrmi-vocabs/interactivityType/active' }]
      }
    });
    expect(out.tagFilters).toHaveProperty('#ext:amb-full:interactivityType:id');
    expect(out.tagFilters['#ext:amb-full:interactivityType:id']).toEqual([
      'http://purl.org/dcx/lrmi-vocabs/interactivityType/active'
    ]);
  });

  test('emits the bare #ext:<ns>:<facet> for scalar ext fields', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ value: 'foo' }]
      }
    });
    expect(out.tagFilters).toHaveProperty('#ext:amb-full:interactivityType');
    expect(out.tagFilters['#ext:amb-full:interactivityType']).toEqual(['foo']);
  });

  test('groups multiple values under one filter key (OR semantics)', () => {
    const out = buildSearchFilterObject({
      extFields: {
        [extKey]: [{ id: 'http://example.org/a' }, { id: 'http://example.org/b' }]
      }
    });
    expect(out.tagFilters['#ext:amb-full:interactivityType:id']).toEqual([
      'http://example.org/a',
      'http://example.org/b'
    ]);
  });

  test('ignores entries with neither id nor value', () => {
    const out = buildSearchFilterObject({ extFields: { [extKey]: [{}] } });
    expect(out.tagFilters).toEqual({});
  });

  test('a reverse-DNS namespace survives intact', () => {
    const out = buildSearchFilterObject({
      extFields: {
        'org.edufeed.ekw.konfi:themen': [{ id: 'http://example.org/thema/1' }]
      }
    });
    expect(out.tagFilters).toHaveProperty('#ext:org.edufeed.ekw.konfi:themen:id');
  });

  // The bug this issue was filed for: the pre-migration key shape carried the
  // kind, the author pubkey and the d-tag. `ns` and `facet` MUST NOT contain
  // ':', so such a key has no valid reading. Emitting a filter from it anyway
  // produced a query that silently matched nothing.
  test('rejects the pre-NIP-AMB key shape instead of emitting a dead filter', () => {
    const out = buildSearchFilterObject({
      extFields: {
        '30168:aaa:amb-full:interactivityType': [{ id: 'http://example.org/a' }]
      }
    });
    expect(out.tagFilters).toEqual({});
  });

  test.each([
    ['no facet segment', 'amb-full'],
    ['empty ns', ':facet'],
    ['empty facet', 'ns:'],
    ['empty key', '']
  ])('rejects a malformed key (%s)', (_label, key) => {
    const out = buildSearchFilterObject({ extFields: { [key]: [{ id: 'x' }] } });
    expect(out.tagFilters).toEqual({});
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

describe('buildSearchFilterObject — concept ids in relay tag filters (NIP-VOCAB forms)', () => {
  const PK = 'd2689e2f41dabfba953da26655a94ce2aa4e029c383ee921c6a4deafab99a612';
  const canonical = identifierFromAddress(`39738:${PK}:doppelstunde`);
  const legacy = `nostr:39738:${PK}:doppelstunde`;

  test('a canonical naddr chip id queries both the canonical and the legacy stored form (relays cannot canonicalise)', () => {
    const out = buildSearchFilterObject({ extFields: { 'ekw:zeitstruktur': [{ id: canonical }] } });
    const key = String(Object.keys(out.tagFilters).find((k) => k.endsWith(':id')));
    expect(out.tagFilters[key]).toEqual([canonical, legacy]);
  });
  test('a legacy chip id is normalised to the same pair', () => {
    const out = buildSearchFilterObject({ extFields: { 'ekw:zeitstruktur': [{ id: legacy }] } });
    const key = String(Object.keys(out.tagFilters).find((k) => k.endsWith(':id')));
    expect(out.tagFilters[key]).toEqual([canonical, legacy]);
  });
  test('an external URI and a malformed value stay single, as given', () => {
    const out = buildSearchFilterObject({
      extFields: {
        'ekw:zeitstruktur': [{ id: 'https://w3id.org/kim/x' }, { id: 'nostr:39738:zz:x' }]
      }
    });
    const key = String(Object.keys(out.tagFilters).find((k) => k.endsWith(':id')));
    expect(out.tagFilters[key]).toEqual(['https://w3id.org/kim/x', 'nostr:39738:zz:x']);
  });
});
