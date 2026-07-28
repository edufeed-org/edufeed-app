/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { formDataToAmbExt } from '$lib/helpers/educational/formDataToAmbExt.js';
import { EKW_KONFI_NS } from '$lib/helpers/educational/ekwNamespace.js';

// Representative EKW formData — same field shape formDataToEkwTags.test.js uses.
const ekwFormData = {
  gradeLevels: ['https://edufeed.org/ns/ekw-gradelevel#5-6'],
  gradeLevelLabels: [{ id: 'https://edufeed.org/ns/ekw-gradelevel#5-6', label: 'Klasse 5-6' }],
  methodOther: 'Freiarbeit\n\nStationenlernen\n',
  bibleReferences: [' Joh 3,16 ', '']
};

// Representative Konfi formData — same field shape formDataToKonfiTags.test.js uses
// (konfiZielgruppenIds/Labels raw fields, as `formDataToKonfiTags.js` reads them).
const konfiFormData = {
  konfiZielgruppenIds: ['urn:ku3'],
  konfiZielgruppenLabels: [{ id: 'urn:ku3', label: 'KU3' }]
};

describe('formDataToAmbExt', () => {
  it('builds ekw + konfi Concept facets from representative formData', () => {
    const ext = formDataToAmbExt({ ...ekwFormData, ...konfiFormData });
    expect(ext).toEqual({
      ekw: {
        gradeLevel: [
          {
            id: 'https://edufeed.org/ns/ekw-gradelevel#5-6',
            type: 'Concept',
            prefLabel: { de: 'Klasse 5-6' }
          }
        ],
        methodOther: ['Freiarbeit', 'Stationenlernen'],
        bibleReference: ['Joh 3,16']
      },
      [EKW_KONFI_NS]: {
        zielgruppen: [{ id: 'urn:ku3', type: 'Concept', prefLabel: { de: 'KU3' } }]
      }
    });
  });

  it('feeds cleanly into ambToNostr, emitting legal ext:<ns>:<facet>[:sub] keys', () => {
    const ext = formDataToAmbExt({ ...ekwFormData, ...konfiFormData });
    const amb = {
      id: 'x',
      type: ['LearningResource'],
      name: 'n',
      description: 'd',
      inLanguage: ['de'],
      license: { id: 'https://creativecommons.org/licenses/by/4.0/' },
      ext
    };
    const { success, data } = ambToNostr(/** @type {any} */ (amb), {
      pubkey: 'pk',
      timestamp: 0
    });
    expect(success).toBe(true);
    const tags = /** @type {any} */ (data).tags;
    const keys = tags.map((/** @type {string[]} */ t) => t[0]);

    // EKW facets
    expect(keys).toContain('ext:ekw:gradeLevel:id');
    expect(keys).toContain('ext:ekw:gradeLevel:prefLabel:de');
    expect(keys).toContain('ext:ekw:gradeLevel:type');
    expect(keys).toContain('ext:ekw:methodOther');
    expect(keys).toContain('ext:ekw:bibleReference');

    // Konfi facets under the conformant namespace
    expect(keys).toContain(`ext:${EKW_KONFI_NS}:zielgruppen:id`);
    expect(keys).toContain(`ext:${EKW_KONFI_NS}:zielgruppen:prefLabel:de`);
    expect(keys).toContain(`ext:${EKW_KONFI_NS}:zielgruppen:type`);

    // Conformance: the illegal legacy shape must never be emitted.
    expect(keys.some((/** @type {string} */ k) => /^ext:ekw:konfi:/.test(k))).toBe(false);
  });

  it('returns undefined when formData has no EKW and no Konfi data', () => {
    expect(formDataToAmbExt({})).toBeUndefined();
    expect(formDataToAmbExt({ name: 'x', description: 'y' })).toBeUndefined();
  });
});
