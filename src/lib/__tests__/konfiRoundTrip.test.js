/**
 * Round-trip integration test for the Konfi publish/prefill wrapper layer.
 *
 * Spec B (Task 15) called for an E2E that walks the wizard UI publish → reload
 * → edit-prefill. Until Spec C ships the Paraglide labels referenced by the
 * E2E selectors, this unit-level round-trip covers the equivalent functional
 * contract:
 *   - formDataToKonfiTags emits the right ext:ekw:konfi:* triples,
 *     scalar tags, and NIP-32 L/l pair
 *   - parseKonfiTagsToFormData reads them back into the same form-data slots
 *   - inferBildungsbereich resolves the L/l tag back to 'konfi'
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { formDataToKonfiTags } from '$lib/helpers/educational/formDataToKonfiTags.js';
import { parseKonfiTagsToFormData } from '$lib/helpers/educational/parseKonfiTagsToFormData.js';
import { inferBildungsbereich } from '$lib/helpers/educational/inferBildungsbereich.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

const SUB_STEPS = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];

describe('Konfi publish → prefill round trip', () => {
  it('emits and re-parses every Konfi facet without loss', () => {
    const original = {
      konfiZielgruppenIds: ['urn:ku3', 'urn:ku4'],
      konfiZielgruppenLabels: [
        { id: 'urn:ku3', label: 'KU3' },
        { id: 'urn:ku4', label: 'KU4' }
      ],
      konfiLernformatIds: ['urn:lf:gruppe'],
      konfiLernformatLabels: [{ id: 'urn:lf:gruppe', label: 'Gruppe' }],
      konfiThemenIds: ['urn:th:taufe'],
      konfiThemenLabels: [{ id: 'urn:th:taufe', label: 'Taufe' }],
      konfiDimensionenIds: ['urn:dim:glaube'],
      konfiDimensionenLabels: [{ id: 'urn:dim:glaube', label: 'Glaube' }],
      konfiMaterialaufwandIds: ['urn:mat:gering'],
      konfiMaterialaufwandLabels: [{ id: 'urn:mat:gering', label: 'Gering' }],
      subtitle: 'Eine Einheit zur Taufe',
      plainLanguage: true,
      requiredMaterialsNote: 'Bibel, Wasser, Tuch'
    };

    const tags = formDataToKonfiTags(original, SUB_STEPS, 'konfi');
    const roundTripped = parseKonfiTagsToFormData({ tags }, SUB_STEPS);

    // Vocab slots round-trip
    expect(roundTripped.konfiZielgruppenIds).toEqual(original.konfiZielgruppenIds);
    expect(roundTripped.konfiZielgruppenLabels).toEqual(original.konfiZielgruppenLabels);
    expect(roundTripped.konfiLernformatIds).toEqual(original.konfiLernformatIds);
    expect(roundTripped.konfiThemenIds).toEqual(original.konfiThemenIds);
    expect(roundTripped.konfiDimensionenIds).toEqual(original.konfiDimensionenIds);
    expect(roundTripped.konfiMaterialaufwandIds).toEqual(original.konfiMaterialaufwandIds);

    // Scalar slots round-trip
    expect(roundTripped.subtitle).toBe('Eine Einheit zur Taufe');
    expect(roundTripped.plainLanguage).toBe(true);
    expect(roundTripped.requiredMaterialsNote).toBe('Bibel, Wasser, Tuch');
  });

  it('inferBildungsbereich resolves the emitted L/l namespace tag back to "konfi"', () => {
    const tags = formDataToKonfiTags({}, SUB_STEPS, 'konfi');
    const inferred = inferBildungsbereich({ tags });
    expect(inferred).toBe('konfi');
  });

  it('emits no Konfi-namespace tags when called with non-Konfi bildungsbereich tag', () => {
    const tags = formDataToKonfiTags({}, [], undefined);
    expect(tags).toEqual([]);
  });

  it('round-trips an event that mixes Konfi tags with unrelated tags (real event shape)', () => {
    const original = {
      konfiZielgruppenIds: ['urn:ku3'],
      konfiZielgruppenLabels: [{ id: 'urn:ku3', label: 'KU3' }],
      subtitle: 'mixed'
    };
    const konfiTags = formDataToKonfiTags(original, SUB_STEPS, 'konfi');

    // Simulate the real kind-30142 event shape: AMB tags + EKW tags + Konfi tags
    const event = {
      tags: [
        ['d', 'some-slug'],
        ['title', 'Eine Konfi-Einheit'],
        ['ext:ekw:gradeLevel:id', 'urn:grade:7'],
        ...konfiTags
      ]
    };

    const roundTripped = parseKonfiTagsToFormData(event, SUB_STEPS);
    expect(roundTripped.konfiZielgruppenIds).toEqual(['urn:ku3']);
    expect(roundTripped.subtitle).toBe('mixed');
    expect(inferBildungsbereich(event)).toBe('konfi');
  });
});
