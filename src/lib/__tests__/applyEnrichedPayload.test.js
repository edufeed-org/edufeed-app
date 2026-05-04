/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applyEnrichedPayload } from '$lib/helpers/educational/applyEnrichedPayload.js';

/**
 * Build a fresh formData stand-in matching the wizard's shape so each test
 * starts from a clean slate.
 */
function makeFormData(overrides = {}) {
  return {
    bildungsbereich: '',
    urlInput: '',
    name: '',
    description: '',
    inLanguage: 'de',
    image: '',
    identifier: '',
    learningResourceType: [],
    educationalLevels: [],
    keywords: [],
    creators: [],
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    ...overrides
  };
}

describe('applyEnrichedPayload', () => {
  it('returns formData unchanged when result is null/undefined', () => {
    const before = makeFormData({ name: 'Existing' });
    const after = applyEnrichedPayload(before, null);
    expect(after.name).toBe('Existing');
  });

  it('fills empty scalar fields from the payload', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        name: 'Photosynthesis',
        description: 'Lesson about photosynthesis',
        image: 'https://example.org/img.jpg',
        inLanguage: 'en'
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('Photosynthesis');
    expect(after.description).toBe('Lesson about photosynthesis');
    expect(after.image).toBe('https://example.org/img.jpg');
    expect(after.inLanguage).toBe('en');
  });

  it('does NOT overwrite scalar fields that already have user-entered values', () => {
    const formData = makeFormData({ name: 'My Title', description: 'My desc' });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'LLM Title', description: 'LLM desc' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('My Title');
    expect(after.description).toBe('My desc');
  });

  it('maps SKOS concept arrays from {id, prefLabel} → {id, label}', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/text', prefLabel: 'Text' }],
        educationalLevels: [
          { id: 'https://w3id.org/kim/educationalLevel/level_A', prefLabel: 'Sek I' }
        ]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.learningResourceType).toEqual([
      { id: 'https://w3id.org/kim/hcrt/text', label: 'Text' }
    ]);
    expect(after.educationalLevels).toEqual([
      { id: 'https://w3id.org/kim/educationalLevel/level_A', label: 'Sek I' }
    ]);
  });

  it('does NOT overwrite SKOS arrays that already have entries', () => {
    const formData = makeFormData({
      learningResourceType: [{ id: 'existing', label: 'Existing' }]
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        learningResourceType: [{ id: 'new', prefLabel: 'New' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.learningResourceType).toEqual([{ id: 'existing', label: 'Existing' }]);
  });

  it('fills keywords array when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { keywords: ['Biologie', 'Pflanzen'] },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.keywords).toEqual(['Biologie', 'Pflanzen']);
  });

  it('fills creators array (passes through {name, type, id}) when empty', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: {
        creators: [{ name: 'Jane Doe', type: 'Person' }]
      },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.creators).toEqual([{ name: 'Jane Doe', type: 'Person' }]);
  });

  it('applies license string when current value still equals the form default', () => {
    const formData = makeFormData(); // default = CC-BY 4.0
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.license).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('does NOT overwrite license the user explicitly set to a different value', () => {
    const formData = makeFormData({
      license: 'https://creativecommons.org/publicdomain/zero/1.0/'
    });
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.license).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
  });

  it('returns a NEW object (does not mutate input)', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('llm-enriched'),
      payload: { name: 'LLM' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after).not.toBe(formData);
    expect(formData.name).toBe('');
  });

  it('returns formData unchanged when source is amb-jsonld (already handled by AMB path)', () => {
    const formData = makeFormData();
    const result = {
      source: /** @type {const} */ ('amb-jsonld'),
      payload: { name: 'AMB Title' },
      evidence: {},
      baseline: {}
    };
    const after = applyEnrichedPayload(formData, result);
    expect(after.name).toBe('');
  });
});
