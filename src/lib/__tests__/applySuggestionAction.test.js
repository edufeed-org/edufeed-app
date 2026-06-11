/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applySuggestionAction } from '$lib/helpers/educational/applySuggestionAction.js';

/**
 * @param {Record<string, any>} payload
 * @param {Record<string, string>} [evidence]
 */
function ai(payload, evidence = {}) {
  return { source: 'llm-enriched', payload, evidence, baseline: {} };
}

describe('applySuggestionAction — string fields', () => {
  it("'replace' on a string field overwrites formData and sets provenance with evidence", () => {
    const formData = { name: 'Mine' };
    /** @type {Record<string, Array<{id: string, label?: string}>>} */
    const aboutByVocab = {};
    /** @type {Record<string, {source: string, evidence?: string}>} */
    const provenance = {};
    const result = applySuggestionAction(
      'name',
      'replace',
      formData,
      aboutByVocab,
      ai({ name: 'AI' }, { name: 'quote about AI' }),
      provenance
    );
    expect(result.formData.name).toBe('AI');
    expect(result.provenance.name).toEqual({ source: 'llm-enriched', evidence: 'quote about AI' });
  });

  it("'replace' without evidence quote sets provenance without evidence", () => {
    const result = applySuggestionAction(
      'description',
      'replace',
      { description: '' },
      {},
      ai({ description: 'd' }),
      {}
    );
    expect(result.provenance.description).toEqual({ source: 'llm-enriched' });
  });

  it("'dismiss' is a no-op for formData and provenance", () => {
    const formData = { name: 'Mine' };
    const provenance = { name: { source: 'llm-enriched' } };
    const result = applySuggestionAction(
      'name',
      'dismiss',
      formData,
      {},
      ai({ name: 'AI' }),
      provenance
    );
    expect(result.formData).toEqual({ name: 'Mine' });
    expect(result.provenance).toEqual({ name: { source: 'llm-enriched' } });
  });

  it('returns new objects, does not mutate inputs', () => {
    const formData = { name: 'Mine' };
    /** @type {Record<string, {source: string, evidence?: string}>} */
    const provenance = {};
    const result = applySuggestionAction(
      'name',
      'replace',
      formData,
      {},
      ai({ name: 'AI' }),
      provenance
    );
    expect(formData.name).toBe('Mine'); // unchanged
    expect(provenance).toEqual({}); // unchanged
    expect(result.formData).not.toBe(formData);
    expect(result.provenance).not.toBe(provenance);
  });
});

describe('applySuggestionAction — concept arrays', () => {
  it("'replace' on learningResourceType writes formConcepts (id+label)", () => {
    const result = applySuggestionAction(
      'learningResourceType',
      'replace',
      { learningResourceType: [{ id: 'urn:x', label: 'X' }] },
      {},
      ai({ learningResourceType: [{ id: 'urn:a', prefLabel: 'A' }] }),
      {}
    );
    expect(result.formData.learningResourceType).toEqual([{ id: 'urn:a', label: 'A' }]);
  });

  it("'merge' adds AI-only items, preserves user items", () => {
    const result = applySuggestionAction(
      'learningResourceType',
      'merge',
      { learningResourceType: [{ id: 'urn:x', label: 'X' }] },
      {},
      ai({
        learningResourceType: [
          { id: 'urn:a', prefLabel: 'A' },
          { id: 'urn:x', prefLabel: 'X-from-AI' }
        ]
      }),
      {}
    );
    const ids = result.formData.learningResourceType.map((/** @type {{id: string}} */ c) => c.id);
    expect(new Set(ids)).toEqual(new Set(['urn:x', 'urn:a']));
    // user's original entry is kept (not overwritten by AI's prefLabel)
    expect(
      result.formData.learningResourceType.find((/** @type {{id: string}} */ c) => c.id === 'urn:x')
        .label
    ).toBe('X');
  });
});

describe('applySuggestionAction — string arrays (keywords)', () => {
  it("'merge' unions keywords without duplicates", () => {
    const result = applySuggestionAction(
      'keywords',
      'merge',
      { keywords: ['math'] },
      {},
      ai({ keywords: ['math', 'algebra'] }),
      {}
    );
    expect(new Set(result.formData.keywords)).toEqual(new Set(['math', 'algebra']));
  });

  it("'replace' overwrites keywords with AI's set", () => {
    const result = applySuggestionAction(
      'keywords',
      'replace',
      { keywords: ['math'] },
      {},
      ai({ keywords: ['biology'] }),
      {}
    );
    expect(result.formData.keywords).toEqual(['biology']);
  });
});

describe('applySuggestionAction — paired id/label fields (gradeLevels)', () => {
  it("'replace' writes both gradeLevels (ids) and gradeLevelLabels (concepts)", () => {
    const result = applySuggestionAction(
      'gradeLevels',
      'replace',
      { gradeLevels: [], gradeLevelLabels: [] },
      {},
      ai({
        gradeLevels: [
          { id: 'urn:5', prefLabel: '5' },
          { id: 'urn:6', prefLabel: '6' }
        ]
      }),
      {}
    );
    expect(result.formData.gradeLevels).toEqual(['urn:5', 'urn:6']);
    expect(result.formData.gradeLevelLabels).toEqual([
      { id: 'urn:5', label: '5' },
      { id: 'urn:6', label: '6' }
    ]);
  });
});

describe('applySuggestionAction — ekwFachrichtung writes to aboutByVocab', () => {
  it("'replace' writes to aboutByVocab.ekwFachrichtung, not formData", () => {
    const result = applySuggestionAction(
      'ekwFachrichtung',
      'replace',
      {},
      { ekwFachrichtung: [] },
      ai({ ekwFachrichtung: [{ id: 'urn:rel', prefLabel: 'Religion' }] }),
      {}
    );
    expect(result.aboutByVocab.ekwFachrichtung).toEqual([{ id: 'urn:rel', label: 'Religion' }]);
    expect(result.formData).not.toHaveProperty('ekwFachrichtung');
  });
});

describe('applySuggestionAction — bibleReferences', () => {
  it("'replace' overwrites including the [''] sentinel", () => {
    const result = applySuggestionAction(
      'bibleReferences',
      'replace',
      { bibleReferences: [''] },
      {},
      ai({ bibleReferences: ['Joh 3,16'] }),
      {}
    );
    expect(result.formData.bibleReferences).toEqual(['Joh 3,16']);
  });
});
