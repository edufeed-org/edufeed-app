/** @vitest-environment node */
/**
 * Multi-value `learningResourceType` round-trip.
 *
 * Regression guard for git.edufeed.org/edufeed/edufeed-app — "multiple
 * learning resource types are not saved from the metadata form": the wizard
 * lets you pick several LRT concepts, but only the first survived the
 * form → resourceData → AMB → kind-30142 tag path.
 */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { buildResourceData } from '$lib/helpers/educational/buildResourceData.js';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { buildPreviewResource } from '$lib/helpers/educational/buildPreviewResource.js';
import { getAMBLearningResourceTypes } from '$lib/helpers/educational/ambHelpers.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';

const SLIDE = { id: 'https://w3id.org/kim/hcrt/slide', label: 'Präsentation' };
const VIDEO = { id: 'https://w3id.org/kim/hcrt/video', label: 'Video' };
const WORKSHEET = { id: 'https://w3id.org/kim/hcrt/worksheet', label: 'Arbeitsblatt' };

const about = [{ id: 'http://w3id.org/kim/schulfaecher/s1055', label: 'Religion' }];

/** Wizard formData with three learning resource types selected. */
function multiTypeFormData() {
  return /** @type {any} */ ({
    ...createInitialFormData(),
    name: 'Titel',
    description: 'Beschreibung',
    identifier: 'https://example.org/lesson',
    inLanguage: 'de',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    learningResourceType: [SLIDE, VIDEO, WORKSHEET],
    educationalLevels: [{ id: 'https://w3id.org/kim/educationalLevel/level_1', label: 'Primar' }]
  });
}

describe('buildResourceData — multiple learning resource types', () => {
  it('forwards every selected concept, not just the first', () => {
    const rd = buildResourceData(multiTypeFormData(), { about, hasNoUrl: false });
    expect(rd.learningResourceTypes).toEqual([SLIDE.id, VIDEO.id, WORKSHEET.id]);
    expect(rd.learningResourceTypeLabels).toEqual([SLIDE, VIDEO, WORKSHEET]);
  });

  it('still exposes the legacy scalar for single-value consumers', () => {
    const rd = buildResourceData(multiTypeFormData(), { about, hasNoUrl: false });
    expect(rd.learningResourceType).toBe(SLIDE.id);
    expect(rd.learningResourceTypeLabel).toBe(SLIDE.label);
  });

  it('leaves the plural fields empty when nothing is selected', () => {
    const formData = /** @type {any} */ ({
      ...multiTypeFormData(),
      learningResourceType: []
    });
    const rd = buildResourceData(formData, { about, hasNoUrl: false });
    expect(rd.learningResourceTypes).toEqual([]);
    expect(rd.learningResourceTypeLabels).toEqual([]);
    expect(rd.learningResourceType).toBe('');
  });
});

describe('convertFormDataToAMB — multiple learning resource types', () => {
  it('emits one AMB concept per selected type with its own prefLabel', () => {
    const rd = buildResourceData(multiTypeFormData(), { about, hasNoUrl: false });
    const amb = convertFormDataToAMB(/** @type {any} */ (rd));
    expect(amb.learningResourceType).toEqual([
      { id: SLIDE.id, prefLabel: { de: SLIDE.label } },
      { id: VIDEO.id, prefLabel: { de: VIDEO.label } },
      { id: WORKSHEET.id, prefLabel: { de: WORKSHEET.label } }
    ]);
  });

  it('falls back to the legacy scalar when no plural field is present', () => {
    const amb = convertFormDataToAMB(
      /** @type {any} */ ({
        name: 'Titel',
        description: 'Beschreibung',
        inLanguage: 'de',
        license: 'https://creativecommons.org/licenses/by/4.0/',
        learningResourceType: SLIDE.id,
        learningResourceTypeLabel: SLIDE.label
      })
    );
    expect(amb.learningResourceType).toEqual([{ id: SLIDE.id, prefLabel: { de: SLIDE.label } }]);
  });

  it('omits learningResourceType entirely when nothing is selected', () => {
    const rd = buildResourceData(
      /** @type {any} */ ({ ...multiTypeFormData(), learningResourceType: [] }),
      { about, hasNoUrl: false }
    );
    const amb = convertFormDataToAMB(/** @type {any} */ (rd));
    expect(amb.learningResourceType).toBeUndefined();
  });
});

describe('form → kind 30142 tags → form round-trip', () => {
  it('preserves all three types through the published event', () => {
    const rd = buildResourceData(multiTypeFormData(), { about, hasNoUrl: false });
    const amb = convertFormDataToAMB(/** @type {any} */ (rd));
    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '0'.repeat(64),
      timestamp: 1_700_000_000
    });
    expect(result.success).toBe(true);

    const event = { ...result.data, kind: 30142 };
    const roundTripped = getAMBLearningResourceTypes(/** @type {any} */ (event), 'de');
    expect(roundTripped.map((t) => t.id)).toEqual([SLIDE.id, VIDEO.id, WORKSHEET.id]);
    expect(roundTripped.map((t) => t.label)).toEqual([SLIDE.label, VIDEO.label, WORKSHEET.label]);
  });
});

describe('buildPreviewResource — multiple learning resource types', () => {
  it('previews every selected type rather than only the first', () => {
    const preview = buildPreviewResource(multiTypeFormData(), '0'.repeat(64), 'de');
    const ids = (preview.tags ?? [])
      .filter((/** @type {string[]} */ t) => t[0] === 'learningResourceType:id')
      .map((/** @type {string[]} */ t) => t[1]);
    expect(ids).toEqual([SLIDE.id, VIDEO.id, WORKSHEET.id]);
  });
});
