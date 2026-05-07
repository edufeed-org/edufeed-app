/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { applySuggestionAction } from '$lib/helpers/educational/applySuggestionAction.js';

function ai(payload, evidence = {}) {
  return { source: 'llm-enriched', payload, evidence, baseline: {} };
}

describe('applySuggestionAction — string fields', () => {
  it("'replace' on a string field overwrites formData and sets provenance with evidence", () => {
    const formData = { name: 'Mine' };
    const aboutByVocab = {};
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
