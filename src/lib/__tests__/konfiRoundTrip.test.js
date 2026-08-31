/**
 * Round-trip integration test for the Konfi (and EKW) publish/prefill wrapper
 * layer, exercised through the REAL production path:
 *
 *   buildResourceData (wizard submit whitelist)
 *     → convertFormDataToAMB / ambToNostr (what createResource/updateResource call)
 *     → parseEkwTagsToFormData + parseKonfiTagsToFormData (edit-mode prefill)
 *
 * Confirms Task 5's namespace move (Konfi facets now live under
 * `ext:org.edufeed.ekw.konfi:*`, not the illegal `ext:ekw:konfi:*` 5-segment
 * shape) round-trips cleanly, and that the Bildungsbereich NIP-32 `L`/`l` tag
 * (emitted separately by `educational-actions.svelte.js`, mirrored here —
 * see that module's `getBildungsbereichTag` + `bildungsbereichToNip32Tags`
 * call) still resolves back to 'konfi' via `inferBildungsbereich`.
 *
 * No back-compat coverage for the legacy `ext:ekw:konfi:*` shape — dropping
 * it is deliberate (Task 5).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { buildResourceData } from '$lib/helpers/educational/buildResourceData.js';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';
import { parseEkwTagsToFormData } from '$lib/helpers/educational/parseEkwTagsToFormData.js';
import { parseKonfiTagsToFormData } from '$lib/helpers/educational/parseKonfiTagsToFormData.js';
import { inferBildungsbereich } from '$lib/helpers/educational/inferBildungsbereich.js';
import { bildungsbereichToNip32Tags } from '$lib/helpers/educational/bildungsbereichNamespace.js';
import { BILDUNGSBEREICHE } from '$lib/helpers/educational/bildungsbereich.js';

const AUTHOR_PK = 'e'.repeat(64);
const SUB_STEPS = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];

/**
 * Mirror of `buildAMBEventTagsFromFormData` + the Bildungsbereich NIP-32 tag
 * step in `educational-actions.svelte.js#createResource` (which can't be
 * imported in node env — it's a Svelte-runes store module; see
 * `educational/creator-tag-assembly.test.js` for the established pattern).
 * @param {any} resourceData
 */
function publishTags(resourceData) {
  const amb = convertFormDataToAMB(resourceData);
  const result = ambToNostr(/** @type {any} */ (amb), {
    pubkey: AUTHOR_PK,
    timestamp: 1_700_000_000
  });
  if (!result.success || !result.data) throw new Error('conversion failed');
  /** @type {string[][]} */
  const tags = result.data.tags;
  const bildungsbereichTag = /** @type {any} */ (BILDUNGSBEREICHE)[
    /** @type {any} */ (resourceData).bildungsbereich
  ]?.bildungsbereichTag;
  if (bildungsbereichTag) tags.push(...bildungsbereichToNip32Tags(bildungsbereichTag));
  return tags;
}

describe('Konfi publish → prefill round trip (production path)', () => {
  it('emits and re-parses every Konfi facet without loss', () => {
    const rawFormData = /** @type {any} */ ({
      ...createInitialFormData(),
      name: 'Konfi-Einheit',
      description: 'desc',
      inLanguage: 'de',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      bildungsbereich: 'konfi',
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
      konfiZeitstrukturIds: ['urn:zt:wochenende'],
      konfiZeitstrukturLabels: [{ id: 'urn:zt:wochenende', label: 'Wochenende' }],
      konfiZeitstrukturCustom: '3-Tage-Freizeit',
      plainLanguage: true,
      requiredMaterialsNote: 'Bibel, Wasser, Tuch'
    });

    const resourceData = buildResourceData(rawFormData, { about: [], hasNoUrl: true });
    const tags = publishTags(resourceData);
    const event = { tags };
    const roundTripped = parseKonfiTagsToFormData(event, SUB_STEPS);

    // Vocab slots round-trip
    expect(roundTripped.konfiZielgruppenIds).toEqual(rawFormData.konfiZielgruppenIds);
    expect(roundTripped.konfiZielgruppenLabels).toEqual(rawFormData.konfiZielgruppenLabels);
    expect(roundTripped.konfiLernformatIds).toEqual(rawFormData.konfiLernformatIds);
    expect(roundTripped.konfiThemenIds).toEqual(rawFormData.konfiThemenIds);
    expect(roundTripped.konfiDimensionenIds).toEqual(rawFormData.konfiDimensionenIds);
    expect(roundTripped.konfiMaterialaufwandIds).toEqual(rawFormData.konfiMaterialaufwandIds);
    expect(roundTripped.konfiZeitstrukturIds).toEqual(rawFormData.konfiZeitstrukturIds);
    expect(roundTripped.konfiZeitstrukturLabels).toEqual(rawFormData.konfiZeitstrukturLabels);
    expect(roundTripped.konfiZeitstrukturCustom).toBe('3-Tage-Freizeit');

    // Scalar slots round-trip
    expect(roundTripped.plainLanguage).toBe(true);
    expect(roundTripped.requiredMaterialsNote).toBe('Bibel, Wasser, Tuch');

    // Namespace conformance: no illegal ext:ekw:konfi:* key survives.
    expect(tags.some((/** @type {string[]} */ t) => t[0].startsWith('ext:ekw:konfi:'))).toBe(false);
    expect(
      tags.some((/** @type {string[]} */ t) => t[0].startsWith('ext:org.edufeed.ekw.konfi:'))
    ).toBe(true);
  });

  it('inferBildungsbereich resolves the emitted L/l namespace tag back to "konfi"', () => {
    const rawFormData = /** @type {any} */ ({
      ...createInitialFormData(),
      name: 'Konfi-Einheit',
      description: 'desc',
      inLanguage: 'de',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      bildungsbereich: 'konfi'
    });
    const resourceData = buildResourceData(rawFormData, { about: [], hasNoUrl: true });
    const tags = publishTags(resourceData);
    expect(inferBildungsbereich({ tags })).toBe('konfi');
  });

  it('round-trips a real event shape mixing EKW + Konfi facets', () => {
    const rawFormData = /** @type {any} */ ({
      ...createInitialFormData(),
      name: 'Konfi + EKW mix',
      description: 'desc',
      inLanguage: 'de',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      bildungsbereich: 'konfi',
      gradeLevels: ['https://edufeed.org/v/klassenstufen/7'],
      gradeLevelLabels: [{ id: 'https://edufeed.org/v/klassenstufen/7', label: 'Klasse 7' }],
      konfiZielgruppenIds: ['urn:ku3'],
      konfiZielgruppenLabels: [{ id: 'urn:ku3', label: 'KU3' }],
      plainLanguage: true
    });
    const resourceData = buildResourceData(rawFormData, { about: [], hasNoUrl: true });
    const tags = publishTags(resourceData);
    const event = { tags };

    const ekw = parseEkwTagsToFormData(event);
    expect(ekw.gradeLevels).toEqual(['https://edufeed.org/v/klassenstufen/7']);

    const konfi = parseKonfiTagsToFormData(event, SUB_STEPS);
    expect(konfi.konfiZielgruppenIds).toEqual(['urn:ku3']);
    expect(konfi.plainLanguage).toBe(true);

    expect(inferBildungsbereich(event)).toBe('konfi');
  });
});
