/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getFieldConflict, ENRICHABLE_FIELDS } from '$lib/helpers/educational/getFieldConflict.js';

const FORM_DEFAULT_LICENSE = 'https://creativecommons.org/licenses/by/4.0/';

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
