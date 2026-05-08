/**
 * `convertFormDataToAMB` — pedagogical Concept fields.
 *
 * The AMB curriculum picker emits a single SKOS Concept into one of
 * `formData.teaches` / `assesses` / `competencyRequired` (mutually
 * exclusive in v1). This file pins the shape that flows through to the
 * AMB JSON-LD output: each becomes `Concept[]` with `id`, `type:'Concept'`,
 * and `prefLabel: { de: <label> }`. Empty/absent arrays must NOT appear
 * in the output.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  extractLabelFromUri: (/** @type {string} */ uri) => uri
}));

import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';

/** Minimal form-data shell so the helper doesn't crash on missing fields. */
const BASE = /** @type {any} */ ({
  name: 'Test',
  description: 'Desc',
  slug: 'test-slug',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/'
});

const PLANET = {
  id: 'https://lp-bavaria.org/lis_live_isb.c.221308.de',
  type: 'Concept',
  prefLabel: { de: 'Planet Erde' }
};

describe('convertFormDataToAMB — teaches/assesses/competencyRequired', () => {
  it('emits formData.teaches as amb.teaches with id+type+prefLabel preserved', () => {
    const amb = convertFormDataToAMB({ ...BASE, teaches: [PLANET] });
    expect(amb.teaches).toEqual([
      {
        id: PLANET.id,
        type: 'Concept',
        prefLabel: { de: 'Planet Erde' }
      }
    ]);
    expect(amb.assesses).toBeUndefined();
    expect(amb.competencyRequired).toBeUndefined();
  });

  it('emits formData.assesses as amb.assesses', () => {
    const amb = convertFormDataToAMB({ ...BASE, assesses: [PLANET] });
    expect(amb.assesses).toEqual([
      { id: PLANET.id, type: 'Concept', prefLabel: { de: 'Planet Erde' } }
    ]);
    expect(amb.teaches).toBeUndefined();
  });

  it('emits formData.competencyRequired as amb.competencyRequired', () => {
    const amb = convertFormDataToAMB({ ...BASE, competencyRequired: [PLANET] });
    expect(amb.competencyRequired).toEqual([
      { id: PLANET.id, type: 'Concept', prefLabel: { de: 'Planet Erde' } }
    ]);
  });

  it('omits the keys entirely when the arrays are empty or missing', () => {
    const amb = convertFormDataToAMB({
      ...BASE,
      teaches: [],
      assesses: [],
      competencyRequired: []
    });
    expect(amb.teaches).toBeUndefined();
    expect(amb.assesses).toBeUndefined();
    expect(amb.competencyRequired).toBeUndefined();

    const amb2 = convertFormDataToAMB(BASE);
    expect(amb2.teaches).toBeUndefined();
    expect(amb2.assesses).toBeUndefined();
    expect(amb2.competencyRequired).toBeUndefined();
  });
});
