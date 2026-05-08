/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getFieldConflict, ENRICHABLE_FIELDS } from '$lib/helpers/educational/getFieldConflict.js';
import { FORM_DEFAULT_LICENSE } from '$lib/helpers/educational/formDefaults.js';
import { applyEnrichedPayload } from '$lib/helpers/educational/applyEnrichedPayload.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';

/**
 * @param {Record<string, any>} payload
 * @returns {import('$lib/helpers/educational/applyEnrichedPayload.js').ExtractMetadataResult}
 */
function ai(payload) {
  return { source: 'llm-enriched', payload, evidence: {}, baseline: {} };
}

describe('getFieldConflict — string fields', () => {
  const empty = {
    name: '',
    description: '',
    image: '',
    inLanguage: 'de',
    license: FORM_DEFAULT_LICENSE,
    methodOther: ''
  };

  it("returns 'none' when aiSuggestions is null", () => {
    expect(getFieldConflict('name', empty, {}, null)).toBe('none');
  });

  it("returns 'none' when AI has no suggestion for the field", () => {
    expect(getFieldConflict('name', empty, {}, ai({}))).toBe('none');
  });

  it("returns 'auto-applied' when user value is empty and AI has a suggestion", () => {
    expect(getFieldConflict('name', empty, {}, ai({ name: 'Foo' }))).toBe('auto-applied');
  });

  it("returns 'auto-applied' for inLanguage at default 'de' when AI suggests another language", () => {
    expect(getFieldConflict('inLanguage', empty, {}, ai({ inLanguage: 'en' }))).toBe(
      'auto-applied'
    );
  });

  it("returns 'auto-applied' for license at form default when AI suggests another license", () => {
    expect(getFieldConflict('license', empty, {}, ai({ license: 'https://other' }))).toBe(
      'auto-applied'
    );
  });

  it("returns 'none' when user value equals AI suggestion", () => {
    const fd = { ...empty, name: 'Foo' };
    expect(getFieldConflict('name', fd, {}, ai({ name: 'Foo' }))).toBe('none');
  });

  it("returns 'conflict' when user value differs from AI suggestion", () => {
    const fd = { ...empty, name: 'Bar' };
    expect(getFieldConflict('name', fd, {}, ai({ name: 'Foo' }))).toBe('conflict');
  });
});

describe('getFieldConflict — concept arrays (id/prefLabel)', () => {
  const fdEmpty = { learningResourceType: [] };

  it("returns 'auto-applied' when user array is empty and AI has concepts", () => {
    const a = ai({ learningResourceType: [{ id: 'urn:a', prefLabel: 'A' }] });
    expect(getFieldConflict('learningResourceType', fdEmpty, {}, a)).toBe('auto-applied');
  });

  it("returns 'none' when user has the same set", () => {
    const fd = { learningResourceType: [{ id: 'urn:a', label: 'A' }] };
    const a = ai({ learningResourceType: [{ id: 'urn:a', prefLabel: 'A' }] });
    expect(getFieldConflict('learningResourceType', fd, {}, a)).toBe('none');
  });

  it("returns 'additive' when AI is a strict superset of user", () => {
    const fd = { learningResourceType: [{ id: 'urn:a', label: 'A' }] };
    const a = ai({
      learningResourceType: [
        { id: 'urn:a', prefLabel: 'A' },
        { id: 'urn:b', prefLabel: 'B' }
      ]
    });
    expect(getFieldConflict('learningResourceType', fd, {}, a)).toBe('additive');
  });

  it("returns 'conflict' when user and AI sets are disjoint", () => {
    const fd = { learningResourceType: [{ id: 'urn:x', label: 'X' }] };
    const a = ai({ learningResourceType: [{ id: 'urn:a', prefLabel: 'A' }] });
    expect(getFieldConflict('learningResourceType', fd, {}, a)).toBe('conflict');
  });

  it("returns 'conflict' when user has items AI doesn't (partial overlap)", () => {
    const fd = {
      learningResourceType: [
        { id: 'urn:a', label: 'A' },
        { id: 'urn:x', label: 'X' }
      ]
    };
    const a = ai({
      learningResourceType: [
        { id: 'urn:a', prefLabel: 'A' },
        { id: 'urn:b', prefLabel: 'B' }
      ]
    });
    expect(getFieldConflict('learningResourceType', fd, {}, a)).toBe('conflict');
  });
});

describe('getFieldConflict — string arrays (keywords)', () => {
  it("returns 'auto-applied' when user array empty and AI has keywords", () => {
    const a = ai({ keywords: ['math', 'algebra'] });
    expect(getFieldConflict('keywords', { keywords: [] }, {}, a)).toBe('auto-applied');
  });

  it("returns 'additive' when AI superset", () => {
    const a = ai({ keywords: ['math', 'algebra'] });
    expect(getFieldConflict('keywords', { keywords: ['math'] }, {}, a)).toBe('additive');
  });

  it("returns 'none' when sets match", () => {
    const a = ai({ keywords: ['math', 'algebra'] });
    expect(getFieldConflict('keywords', { keywords: ['math', 'algebra'] }, {}, a)).toBe('none');
  });
});

describe('getFieldConflict — bibleReferences with default empty', () => {
  it("treats [''] as empty", () => {
    const a = ai({ bibleReferences: ['Joh 3,16'] });
    expect(getFieldConflict('bibleReferences', { bibleReferences: [''] }, {}, a)).toBe(
      'auto-applied'
    );
  });

  it('conflicts when user has different non-empty entries', () => {
    const a = ai({ bibleReferences: ['Joh 3,16'] });
    expect(getFieldConflict('bibleReferences', { bibleReferences: ['Mt 5,3'] }, {}, a)).toBe(
      'conflict'
    );
  });
});

describe('getFieldConflict — ekwFachrichtung (aboutByVocab-routed)', () => {
  it("returns 'auto-applied' when aboutByVocab.ekwFachrichtung is empty and AI has concepts", () => {
    const a = ai({ ekwFachrichtung: [{ id: 'urn:rel', prefLabel: 'Religion' }] });
    expect(getFieldConflict('ekwFachrichtung', {}, { ekwFachrichtung: [] }, a)).toBe(
      'auto-applied'
    );
  });

  it("returns 'none' when sets match", () => {
    const a = ai({ ekwFachrichtung: [{ id: 'urn:rel', prefLabel: 'Religion' }] });
    expect(
      getFieldConflict(
        'ekwFachrichtung',
        {},
        { ekwFachrichtung: [{ id: 'urn:rel', label: 'Religion' }] },
        a
      )
    ).toBe('none');
  });

  it("returns 'conflict' when user picked something else", () => {
    const a = ai({ ekwFachrichtung: [{ id: 'urn:rel', prefLabel: 'Religion' }] });
    expect(
      getFieldConflict(
        'ekwFachrichtung',
        {},
        { ekwFachrichtung: [{ id: 'urn:other', label: 'X' }] },
        a
      )
    ).toBe('conflict');
  });
});

describe('getFieldConflict — paired-key fields after applyEnrichedPayload', () => {
  it("returns 'none' for gradeLevels after applyEnrichedPayload fills it from the AI", () => {
    const formData = createInitialFormData();
    const result = ai({
      gradeLevels: [
        { id: '39738:abc:1', prefLabel: 'Jahrgang 1' },
        { id: '39738:abc:2', prefLabel: 'Jahrgang 2' }
      ]
    });
    const after = applyEnrichedPayload(formData, result);
    expect(getFieldConflict('gradeLevels', after, {}, result)).toBe('none');
  });

  it("returns 'none' for didacticConcepts after applyEnrichedPayload fills it from the AI", () => {
    const formData = createInitialFormData();
    const result = ai({
      didacticConcepts: [
        { id: '39738:dc:1', prefLabel: 'Frontalunterricht' },
        { id: '39738:dc:2', prefLabel: 'Gruppenarbeit' }
      ]
    });
    const after = applyEnrichedPayload(formData, result);
    expect(getFieldConflict('didacticConcepts', after, {}, result)).toBe('none');
  });

  it("returns 'none' for methods after applyEnrichedPayload fills it from the AI", () => {
    const formData = createInitialFormData();
    const result = ai({
      methods: [
        { id: '39738:m:1', prefLabel: 'Diskussion' },
        { id: '39738:m:2', prefLabel: 'Rollenspiel' }
      ]
    });
    const after = applyEnrichedPayload(formData, result);
    expect(getFieldConflict('methods', after, {}, result)).toBe('none');
  });

  it("returns 'conflict' when user value is non-empty and disjoint from AI", () => {
    const formData = {
      ...createInitialFormData(),
      schoolTypes: ['user-id'],
      schoolTypeLabels: [{ id: 'user-id', label: 'Berufliche Schule' }]
    };
    const result = ai({ schoolTypes: [{ id: 'ai-id', prefLabel: 'Grundschule' }] });
    expect(getFieldConflict('schoolTypes', formData, {}, result)).toBe('conflict');
  });

  // Regression: FormConceptPicker label-heal rewrites the IDs in formData to
  // canonical nostr-coords once Concept events load, while aiSuggestions.payload
  // still carries the AI's original (e.g. external-URI) IDs. Pure ID comparison
  // produces a false-positive 'conflict' even though labels match. Compare by
  // label for paired-key fields.
  it("returns 'none' for gradeLevels when picker rewrote formData IDs to canonical nostr-coords (labels stable)", () => {
    const formData = {
      ...createInitialFormData(),
      gradeLevels: ['nostr:39738:pubkey:1', 'nostr:39738:pubkey:2'],
      gradeLevelLabels: [
        { id: 'nostr:39738:pubkey:1', label: 'Jahrgang 1' },
        { id: 'nostr:39738:pubkey:2', label: 'Jahrgang 2' }
      ]
    };
    const result = ai({
      gradeLevels: [
        { id: '39738:abc:1', prefLabel: 'Jahrgang 1' },
        { id: '39738:abc:2', prefLabel: 'Jahrgang 2' }
      ]
    });
    expect(getFieldConflict('gradeLevels', formData, {}, result)).toBe('none');
  });

  it("returns 'additive' for paired-key field when AI labels are a strict superset of user labels (IDs may differ)", () => {
    const formData = {
      ...createInitialFormData(),
      methods: ['nostr:39738:pubkey:m1'],
      methodLabels: [{ id: 'nostr:39738:pubkey:m1', label: 'Diskussion' }]
    };
    const result = ai({
      methods: [
        { id: 'ai:m1', prefLabel: 'Diskussion' },
        { id: 'ai:m2', prefLabel: 'Rollenspiel' }
      ]
    });
    expect(getFieldConflict('methods', formData, {}, result)).toBe('additive');
  });

  it("returns 'conflict' for paired-key field when labels are genuinely disjoint", () => {
    const formData = {
      ...createInitialFormData(),
      schoolTypes: ['nostr:39738:pubkey:s1'],
      schoolTypeLabels: [{ id: 'nostr:39738:pubkey:s1', label: 'Berufliche Schule' }]
    };
    const result = ai({
      schoolTypes: [{ id: 'ai:s1', prefLabel: 'Grundschule' }]
    });
    expect(getFieldConflict('schoolTypes', formData, {}, result)).toBe('conflict');
  });
});

describe('ENRICHABLE_FIELDS', () => {
  it('includes the user-facing string and array fields', () => {
    expect(ENRICHABLE_FIELDS).toContain('name');
    expect(ENRICHABLE_FIELDS).toContain('description');
    expect(ENRICHABLE_FIELDS).toContain('keywords');
    expect(ENRICHABLE_FIELDS).toContain('learningResourceType');
    expect(ENRICHABLE_FIELDS).toContain('ekwFachrichtung');
  });

  it('does not include label-mirror fields', () => {
    expect(ENRICHABLE_FIELDS).not.toContain('gradeLevelLabels');
    expect(ENRICHABLE_FIELDS).not.toContain('schoolTypeLabels');
  });
});
