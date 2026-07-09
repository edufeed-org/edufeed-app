/**
 * Tests for the educator profile helper: kind-0 `edufeed` object parsing and
 * Bildungsbereich ↔ profile concept mapping.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  getBildungsbereichProfileConcepts,
  bildungsbereichKeyFromConceptId,
  getSubjectVocabKeysForConcepts,
  parseEdufeedProfile,
  interestsFromListEvent,
  resolveProfileInterests,
  subjectsToPickerValue,
  mergeSubjectsForVocab,
  pickConceptLabel
} from '../helpers/educational/educatorProfile.js';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from '../helpers/educational/bildungsbereichNamespace.js';

describe('getBildungsbereichProfileConcepts', () => {
  it('returns one concept per Bildungsbereich with namespace IRI and de/en labels', () => {
    const concepts = getBildungsbereichProfileConcepts();

    expect(concepts.length).toBeGreaterThanOrEqual(4);
    const schule = concepts.find((c) => c.id === `${BILDUNGSBEREICH_NAMESPACE_IRI}schule`);
    expect(schule).toBeTruthy();
    expect(schule?.prefLabel?.de).toBe('Schule');
    expect(schule?.prefLabel?.en).toBe('School');
  });
});

describe('bildungsbereichKeyFromConceptId', () => {
  it('round-trips every generated concept back to its key', () => {
    for (const concept of getBildungsbereichProfileConcepts()) {
      const key = bildungsbereichKeyFromConceptId(concept.id);
      expect(concept.id).toBe(`${BILDUNGSBEREICH_NAMESPACE_IRI}${key}`);
    }
  });

  it('returns undefined for foreign or malformed ids', () => {
    expect(bildungsbereichKeyFromConceptId('https://example.org/other#schule')).toBeUndefined();
    expect(
      bildungsbereichKeyFromConceptId(`${BILDUNGSBEREICH_NAMESPACE_IRI}not-a-bereich`)
    ).toBeUndefined();
    expect(bildungsbereichKeyFromConceptId(undefined)).toBeUndefined();
  });
});

describe('getSubjectVocabKeysForConcepts', () => {
  const concept = (/** @type {string} */ key) => ({
    id: `${BILDUNGSBEREICH_NAMESPACE_IRI}${key}`,
    prefLabel: { de: key }
  });

  it('maps schule to the schulfaecher vocab', () => {
    expect(getSubjectVocabKeysForConcepts([concept('schule')])).toEqual(['schulfaecher']);
  });

  it('unions and dedupes vocab keys across selected Bildungsbereiche', () => {
    expect(
      getSubjectVocabKeysForConcepts([concept('schule'), concept('hochschule'), concept('extra')])
    ).toEqual(['schulfaecher', 'hochschulfaecher']);
  });

  it('ignores unknown concepts and returns [] when nothing maps', () => {
    expect(getSubjectVocabKeysForConcepts([concept('konfi')])).toEqual([]);
    expect(getSubjectVocabKeysForConcepts([{ id: 'https://example.org/x' }])).toEqual([]);
    expect(getSubjectVocabKeysForConcepts([])).toEqual([]);
  });
});

describe('parseEdufeedProfile', () => {
  const EMPTY = { interests: [], educationalLevels: [], subjects: [], locations: [] };

  it('returns empty defaults for missing or edufeed-less content', () => {
    expect(parseEdufeedProfile(undefined)).toEqual(EMPTY);
    expect(parseEdufeedProfile(null)).toEqual(EMPTY);
    expect(parseEdufeedProfile({ name: 'Anna' })).toEqual(EMPTY);
  });

  it('returns empty defaults for malformed edufeed values', () => {
    expect(parseEdufeedProfile({ edufeed: 'oops' })).toEqual(EMPTY);
    expect(parseEdufeedProfile({ edufeed: 42 })).toEqual(EMPTY);
    expect(parseEdufeedProfile({ edufeed: [] })).toEqual(EMPTY);
    expect(
      parseEdufeedProfile({ edufeed: { interests: 'nope', educationalLevels: {}, subjects: 3 } })
    ).toEqual(EMPTY);
  });

  it('passes through well-formed data', () => {
    const edufeed = {
      interests: ['Klettern', 'Podcasts'],
      educationalLevels: [
        { id: `${BILDUNGSBEREICH_NAMESPACE_IRI}schule`, prefLabel: { de: 'Schule' } }
      ],
      subjects: [{ id: 'https://example.org/subject/religion', prefLabel: { de: 'Religion' } }],
      locations: [{ name: 'Köln, Deutschland', lat: 50.94, lng: 6.96 }]
    };

    expect(parseEdufeedProfile({ name: 'Anna', edufeed })).toEqual(edufeed);
  });

  it('filters out non-string interests and concepts without a string id', () => {
    const result = parseEdufeedProfile({
      edufeed: {
        interests: ['ok', 42, null, ''],
        educationalLevels: [{ id: 'https://ok' }, { prefLabel: { de: 'no id' } }, 'nope', null],
        subjects: [{ id: 7 }, { id: 'https://also-ok', prefLabel: { de: 'X' } }]
      }
    });

    expect(result.interests).toEqual(['ok']);
    expect(result.educationalLevels).toEqual([{ id: 'https://ok' }]);
    expect(result.subjects).toEqual([{ id: 'https://also-ok', prefLabel: { de: 'X' } }]);
  });

  it('dedupes interests case-insensitively and concepts by id', () => {
    const result = parseEdufeedProfile({
      edufeed: {
        interests: ['Podcasts', 'podcasts', 'OER'],
        educationalLevels: [{ id: 'https://a' }, { id: 'https://a' }, { id: 'https://b' }],
        subjects: [
          { id: 'https://s', prefLabel: { de: 'X' } },
          { id: 'https://s', prefLabel: { de: 'X (Dublette)' } }
        ]
      }
    });

    expect(result.interests).toEqual(['Podcasts', 'OER']);
    expect(result.educationalLevels).toEqual([{ id: 'https://a' }, { id: 'https://b' }]);
    expect(result.subjects).toEqual([{ id: 'https://s', prefLabel: { de: 'X' } }]);
  });
});

describe('interestsFromListEvent', () => {
  it('extracts t-tag values from a kind 10015 event', () => {
    const event = /** @type {any} */ ({
      kind: 10015,
      tags: [
        ['t', 'Klettern'],
        ['t', 'Podcasts'],
        ['a', '30015:pub:oer'],
        ['alt', 'Interests']
      ]
    });
    expect(interestsFromListEvent(event)).toEqual(['Klettern', 'Podcasts']);
  });

  it('trims, drops empties, and dedupes case-insensitively keeping first spelling', () => {
    const event = /** @type {any} */ ({
      kind: 10015,
      tags: [['t', ' Klettern '], ['t', ''], ['t'], ['t', 'klettern'], ['t', 'OER']]
    });
    expect(interestsFromListEvent(event)).toEqual(['Klettern', 'OER']);
  });

  it('returns [] for null/undefined events or missing tags', () => {
    expect(interestsFromListEvent(null)).toEqual([]);
    expect(interestsFromListEvent(undefined)).toEqual([]);
    expect(interestsFromListEvent(/** @type {any} */ ({ kind: 10015 }))).toEqual([]);
  });
});

describe('resolveProfileInterests', () => {
  const legacyContent = { edufeed: { interests: ['Legacy-A', 'Legacy-B'] } };

  it('uses the kind 10015 list when present, even when empty', () => {
    const listEvent = /** @type {any} */ ({ kind: 10015, tags: [['t', 'Klettern']] });
    expect(resolveProfileInterests(listEvent, legacyContent)).toEqual(['Klettern']);

    const emptyList = /** @type {any} */ ({ kind: 10015, tags: [] });
    expect(resolveProfileInterests(emptyList, legacyContent)).toEqual([]);
  });

  it('falls back to legacy edufeed.interests when no list event exists', () => {
    expect(resolveProfileInterests(null, legacyContent)).toEqual(['Legacy-A', 'Legacy-B']);
  });

  it('returns [] when neither source has interests', () => {
    expect(resolveProfileInterests(null, {})).toEqual([]);
    expect(resolveProfileInterests(null, null)).toEqual([]);
  });
});

describe('pickConceptLabel', () => {
  it('prefers the requested locale, then de, then en, then any available label', () => {
    expect(pickConceptLabel({ de: 'Schule', en: 'School' }, 'en')).toBe('School');
    expect(pickConceptLabel({ de: 'Schule' }, 'en')).toBe('Schule');
    expect(pickConceptLabel({ en: 'School' }, 'fr')).toBe('School');
    expect(pickConceptLabel({ fr: 'École' }, 'de')).toBe('École');
  });

  it('returns an empty string for missing or empty prefLabel', () => {
    expect(pickConceptLabel(undefined, 'de')).toBe('');
    expect(pickConceptLabel({}, 'de')).toBe('');
  });
});

describe('subjects ↔ picker value conversion', () => {
  const mathe = {
    id: 'https://w3id.org/kim/schulfaecher/s1017',
    prefLabel: { de: 'Mathematik', en: 'Mathematics' },
    vocab: 'schulfaecher'
  };
  const theologie = {
    id: 'https://example.org/hochschulfaecher/theologie',
    prefLabel: { de: 'Theologie' },
    vocab: 'hochschulfaecher'
  };
  const foreign = { id: 'https://example.org/foreign', prefLabel: { de: 'Fremd' } };

  describe('subjectsToPickerValue', () => {
    it('maps only subjects of the given vocab to the rich picker shape', () => {
      expect(subjectsToPickerValue([mathe, theologie, foreign], 'schulfaecher')).toEqual([
        {
          id: mathe.id,
          nostrCoord: '',
          relay: '',
          labels: { de: 'Mathematik', en: 'Mathematics' }
        }
      ]);
    });

    it('tolerates subjects without prefLabel', () => {
      expect(
        subjectsToPickerValue([{ id: 'https://x', vocab: 'schulfaecher' }], 'schulfaecher')
      ).toEqual([{ id: 'https://x', nostrCoord: '', relay: '', labels: {} }]);
    });
  });

  describe('mergeSubjectsForVocab', () => {
    it('replaces the vocab slice and keeps other-vocab and untagged subjects', () => {
      const picked = [
        {
          id: 'https://w3id.org/kim/schulfaecher/s1002',
          nostrCoord: '39737:pub:s1002',
          relay: 'wss://r.example',
          labels: { de: 'Biologie' }
        }
      ];

      expect(mergeSubjectsForVocab([mathe, theologie, foreign], 'schulfaecher', picked)).toEqual([
        theologie,
        foreign,
        {
          id: 'https://w3id.org/kim/schulfaecher/s1002',
          prefLabel: { de: 'Biologie' },
          vocab: 'schulfaecher'
        }
      ]);
    });

    it('clears the vocab slice when nothing is picked', () => {
      expect(mergeSubjectsForVocab([mathe, theologie], 'schulfaecher', [])).toEqual([theologie]);
    });
  });
});

describe('parseEdufeedProfile — locations (issue #25)', () => {
  it('parses locations with name and coordinates', () => {
    const profile = parseEdufeedProfile({
      edufeed: {
        locations: [{ name: 'Köln, Deutschland', lat: 50.94, lng: 6.96 }, { name: 'Bonn' }]
      }
    });
    expect(profile.locations).toEqual([
      { name: 'Köln, Deutschland', lat: 50.94, lng: 6.96 },
      { name: 'Bonn' }
    ]);
  });

  it('returns [] when locations are missing or malformed', () => {
    expect(parseEdufeedProfile({ edufeed: {} }).locations).toEqual([]);
    expect(parseEdufeedProfile({}).locations).toEqual([]);
    expect(parseEdufeedProfile({ edufeed: { locations: 'Köln' } }).locations).toEqual([]);
    expect(
      parseEdufeedProfile({ edufeed: { locations: [{ lat: 1 }, 42, { name: '' }] } }).locations
    ).toEqual([]);
  });

  it('drops non-numeric coordinates but keeps the name', () => {
    expect(
      parseEdufeedProfile({ edufeed: { locations: [{ name: 'Köln', lat: 'x', lng: null }] } })
        .locations
    ).toEqual([{ name: 'Köln' }]);
  });
});
