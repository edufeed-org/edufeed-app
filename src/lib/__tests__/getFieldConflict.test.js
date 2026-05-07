/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getFieldConflict, ENRICHABLE_FIELDS } from '$lib/helpers/educational/getFieldConflict.js';
import { FORM_DEFAULT_LICENSE } from '$lib/helpers/educational/formDefaults.js';

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
