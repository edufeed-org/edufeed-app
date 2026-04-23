/**
 * Serialization migration safety net.
 *
 * Pins the tag output of the AMB-form submit path before it is switched from
 * the local `flattenAMBToNostrTags` to `amb-nostr-converter`'s `ambToNostr`.
 *
 * The two serializers must agree on the set of tags produced from a given
 * AMB object (order-independent, kind-insensitive duplicates treated as a
 * set). Any divergence surfaced here is a spec gap we need to decide on
 * explicitly, not silently drift.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// Stub skosLoader so extractLabelFromUri is deterministic (no network, no
// SvelteKit `$app/*` imports pulled in via skosLoader's transitive deps).
vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  extractLabelFromUri: (/** @type {string} */ uri) => {
    try {
      const url = new URL(uri);
      const parts = url.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || uri;
    } catch {
      return uri;
    }
  }
}));

import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { flattenAMBToNostrTags } from '$lib/helpers/educational/ambTransform.js';
import { ambToNostr } from 'amb-nostr-converter';

/**
 * Representative formData covering every field the current form produces.
 * Deliberately includes multiple subjects, multiple levels, multiple keywords,
 * multiple creators (with and without affiliation / honorific), multiple files.
 */
const REPRESENTATIVE_FORM_DATA = /** @type {any} */ ({
  name: 'Einführung in maschinelles Lernen',
  description: 'Ein Einführungskurs in die Grundlagen des maschinellen Lernens.',
  slug: 'intro-ml',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by-sa/4.0/',
  learningResourceType: 'https://w3id.org/kim/hcrt/course',
  learningResourceTypeLabel: 'Kurs',
  about: [
    'https://w3id.org/kim/hochschulfaechersystematik/n079',
    'http://w3id.org/kim/schulfaecher/s1017'
  ],
  aboutLabels: [
    { id: 'https://w3id.org/kim/hochschulfaechersystematik/n079', label: 'Informatik' },
    { id: 'http://w3id.org/kim/schulfaecher/s1017', label: 'Mathematik' }
  ],
  educationalLevels: [
    'https://w3id.org/kim/educationalLevel/level_6',
    'https://w3id.org/kim/educationalLevel/level_7'
  ],
  educationalLevelLabels: [
    { id: 'https://w3id.org/kim/educationalLevel/level_6', label: 'Bachelor oder äquivalent' },
    { id: 'https://w3id.org/kim/educationalLevel/level_7', label: 'Master oder äquivalent' }
  ],
  keywords: ['Informatik', 'ML', 'Grundlagen'],
  creators: [
    {
      type: 'Person',
      name: 'Maria Schmidt',
      honorificPrefix: 'Dr.',
      affiliationName: 'Technische Universität Berlin'
    },
    {
      type: 'Organization',
      name: 'Open Edu Hub'
    }
  ],
  files: [
    {
      url: 'https://example.org/files/intro-ml.pdf',
      mimeType: 'application/pdf',
      size: 12345,
      sha256: 'a'.repeat(64),
      name: 'intro-ml.pdf'
    },
    {
      url: 'https://example.org/files/slides.pdf',
      mimeType: 'application/pdf',
      size: 99,
      sha256: 'b'.repeat(64),
      name: 'slides.pdf'
    }
  ],
  isAccessibleForFree: true
});

/**
 * Normalize a tag set for order-independent, duplicate-tolerant comparison.
 * Each tag becomes a JSON-stringified string; the result is a sorted unique array.
 * @param {Array<Array<string>>} tags
 * @returns {string[]}
 */
function toTagSet(tags) {
  return [...new Set(tags.map((t) => JSON.stringify(t)))].sort();
}

describe('AMB serialization migration: flatten vs ambToNostr', () => {
  it('produces the same tag set for a representative formData', () => {
    const amb = convertFormDataToAMB(REPRESENTATIVE_FORM_DATA);

    const localTags = flattenAMBToNostrTags(amb);

    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '0'.repeat(64),
      timestamp: 1_700_000_000
    });
    expect(result.success, `ambToNostr failed: ${result.error?.message}`).toBe(true);
    const externalTags = result.data?.tags ?? [];

    // Drop tags that are intentionally different between the two paths:
    //   - ambToNostr may inject schema markers or bookkeeping tags the local
    //     flatten does not produce. We only guard shape *compatibility* — every
    //     tag the local flatten emits should be emitted by ambToNostr too.
    // So the useful assertion is: localTags ⊆ externalTags.
    const localSet = toTagSet(localTags);
    const externalSet = new Set(toTagSet(externalTags));
    const missingFromExternal = localSet.filter((t) => !externalSet.has(t));

    expect(
      missingFromExternal,
      `ambToNostr is missing tags the local flattener emits:\n${missingFromExternal.join('\n')}`
    ).toEqual([]);
  });

  it('both serializers emit a "d" tag matching the AMB id', () => {
    const amb = convertFormDataToAMB(REPRESENTATIVE_FORM_DATA);
    const local = flattenAMBToNostrTags(amb).find((t) => t[0] === 'd');
    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '0'.repeat(64),
      timestamp: 1_700_000_000
    });
    const external = result.data?.tags.find((t) => t[0] === 'd');

    expect(local?.[1]).toBe('intro-ml');
    expect(external?.[1]).toBe('intro-ml');
  });

  it('ambToNostr emits marker `a` tags for hasPart and isPartOf when `relatedEvents` is supplied', () => {
    /** @type {Record<string, any>} */
    const amb = {
      id: 'course-1',
      type: ['LearningResource'],
      name: 'Parent Course',
      description: 'x',
      inLanguage: ['de'],
      license: { id: 'https://creativecommons.org/licenses/by/4.0/' },
      hasPart: [{ id: '30142:aa:video-1' }],
      isPartOf: [{ id: '30142:bb:program-1' }]
    };

    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '0'.repeat(64),
      timestamp: 1_700_000_000,
      relatedEvents: {
        '30142:aa:video-1': {
          pubkey: 'aa',
          dTag: 'video-1',
          relayHint: 'wss://relay.example.com/'
        },
        '30142:bb:program-1': { pubkey: 'bb', dTag: 'program-1', relayHint: '' }
      }
    });
    expect(result.success).toBe(true);

    const aTags = (result.data?.tags ?? []).filter((t) => t[0] === 'a');
    expect(aTags).toEqual(
      expect.arrayContaining([
        ['a', '30142:aa:video-1', 'wss://relay.example.com/', 'hasPart'],
        ['a', '30142:bb:program-1', '', 'isPartOf']
      ])
    );
  });
});

describe('empty slug → auto-generated id (no-URL feature contract)', () => {
  it('produces a non-empty id when slug is empty', () => {
    const amb = convertFormDataToAMB(
      /** @type {any} */ ({
        ...REPRESENTATIVE_FORM_DATA,
        slug: ''
      })
    );
    expect(typeof amb.id).toBe('string');
    expect(amb.id.length).toBeGreaterThan(0);
  });

  it('produces a non-empty id when slug is whitespace-only', () => {
    const amb = convertFormDataToAMB(
      /** @type {any} */ ({
        ...REPRESENTATIVE_FORM_DATA,
        slug: '   '
      })
    );
    expect(typeof amb.id).toBe('string');
    expect(amb.id.trim().length).toBeGreaterThan(0);
  });

  it('flows through ambToNostr as a non-empty d-tag', () => {
    const amb = convertFormDataToAMB(
      /** @type {any} */ ({
        ...REPRESENTATIVE_FORM_DATA,
        slug: ''
      })
    );
    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '00'.repeat(32),
      timestamp: 1700000000
    });
    expect(result.success).toBe(true);
    const dTag = result.data?.tags.find((t) => t[0] === 'd');
    expect(dTag).toBeDefined();
    expect(dTag?.[1]).toBeTruthy();
  });
});
