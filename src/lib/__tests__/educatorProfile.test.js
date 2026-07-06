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
  parseEdufeedProfile
} from '../helpers/educational/educatorProfile.js';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from '../helpers/educational/bildungsbereichNamespace.js';

describe('getBildungsbereichProfileConcepts', () => {
  it('returns one concept per Bildungsbereich with namespace IRI and de/en labels', () => {
    const concepts = getBildungsbereichProfileConcepts();

    expect(concepts.length).toBeGreaterThanOrEqual(4);
    const schule = concepts.find((c) => c.id === `${BILDUNGSBEREICH_NAMESPACE_IRI}schule`);
    expect(schule).toBeTruthy();
    expect(schule.prefLabel.de).toBe('Schule');
    expect(schule.prefLabel.en).toBe('School');
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
  const concept = (key) => ({
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
  const EMPTY = { interests: [], educationalLevels: [], subjects: [] };

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
      subjects: [{ id: 'https://example.org/subject/religion', prefLabel: { de: 'Religion' } }]
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
});
