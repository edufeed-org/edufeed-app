/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';

describe('createInitialFormData', () => {
  it('returns an empty/default form-data shape', () => {
    const fd = createInitialFormData();
    expect(fd.bildungsbereich).toBe('');
    expect(fd.urlInput).toBe('');
    expect(fd.name).toBe('');
    expect(fd.description).toBe('');
    expect(fd.identifier).toBe('');
    expect(fd.image).toBe('');
    expect(fd.inLanguage).toBe('de');

    // Arrays start empty (with bibleReferences carrying one empty slot).
    expect(fd.learningResourceType).toEqual([]);
    expect(fd.educationalLevels).toEqual([]);
    expect(fd.keywords).toEqual([]);
    expect(fd.creators).toEqual([]);
    expect(fd.encodings).toEqual([]);
    expect(fd.externalUrls).toEqual([]);
    expect(fd.hasPart).toEqual([]);
    expect(fd.isPartOf).toEqual([]);
    expect(fd.gradeLevels).toEqual([]);
    expect(fd.gradeLevelLabels).toEqual([]);
    expect(fd.schoolTypes).toEqual([]);
    expect(fd.schoolTypeLabels).toEqual([]);
    expect(fd.didacticConcepts).toEqual([]);
    expect(fd.didacticConceptLabels).toEqual([]);
    expect(fd.methods).toEqual([]);
    expect(fd.methodLabels).toEqual([]);
    expect(fd.methodOther).toBe('');
    expect(fd.bibleReferences).toEqual(['']);

    expect(fd.license).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(fd.isAccessibleForFree).toBe(true);
  });

  it('returns a fresh independent object on each call', () => {
    const a = createInitialFormData();
    const b = createInitialFormData();
    expect(a).not.toBe(b);
    expect(a.keywords).not.toBe(b.keywords);
    expect(a.bibleReferences).not.toBe(b.bibleReferences);

    // Mutating one must not affect the other.
    a.keywords.push('x');
    a.bibleReferences[0] = 'Joh 3,16';
    expect(b.keywords).toEqual([]);
    expect(b.bibleReferences).toEqual(['']);
  });
});
