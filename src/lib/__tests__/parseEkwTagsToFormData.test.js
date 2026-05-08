/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseEkwTagsToFormData } from '$lib/helpers/educational/parseEkwTagsToFormData.js';

describe('parseEkwTagsToFormData', () => {
  it('parses canonical ext:ekw:* tags into form-data fragment', () => {
    const event = {
      tags: [
        ['ext:ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ext:ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ext:ekw:gradeLevel:type', 'Concept'],
        ['ext:ekw:schoolType:id', 'https://edufeed.org/v/schulart/grundschule'],
        ['ext:ekw:schoolType:prefLabel:de', 'Grundschule (1–4)'],
        ['ext:ekw:schoolType:type', 'Concept'],
        ['ext:ekw:didacticConcept:id', 'https://edufeed.org/v/didaktisches-konzept/symboldidaktik'],
        ['ext:ekw:didacticConcept:prefLabel:de', 'Symboldidaktik / Symbollernen'],
        ['ext:ekw:didacticConcept:type', 'Concept'],
        ['ext:ekw:method:id', 'https://edufeed.org/v/methode/rollenspiel'],
        ['ext:ekw:method:prefLabel:de', 'Rollenspiel'],
        ['ext:ekw:method:type', 'Concept'],
        ['ext:ekw:methodOther', 'Freie Methode A'],
        ['ext:ekw:methodOther', 'Freie Methode B'],
        ['ext:ekw:bibleReference', 'Mt 5,3–12'],
        ['ext:ekw:bibleReference', 'Joh 3,16']
      ]
    };

    const parsed = parseEkwTagsToFormData(event);

    expect(parsed.gradeLevels).toEqual(['https://edufeed.org/v/klassenstufen/5-6']);
    expect(parsed.gradeLevelLabels).toEqual([
      { id: 'https://edufeed.org/v/klassenstufen/5-6', label: '5–6' }
    ]);
    expect(parsed.schoolTypes).toEqual(['https://edufeed.org/v/schulart/grundschule']);
    expect(parsed.didacticConcepts).toEqual([
      'https://edufeed.org/v/didaktisches-konzept/symboldidaktik'
    ]);
    expect(parsed.methods).toEqual(['https://edufeed.org/v/methode/rollenspiel']);
    expect(parsed.methodOther).toBe('Freie Methode A\nFreie Methode B');
    expect(parsed.bibleReferences).toEqual(['Mt 5,3–12', 'Joh 3,16']);
  });

  it('parses legacy unprefixed ekw:* tags identically', () => {
    const event = {
      tags: [
        ['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6'],
        ['ekw:gradeLevel:prefLabel:de', '5–6'],
        ['ekw:gradeLevel:type', 'Concept'],
        ['ekw:schoolType:id', 'https://edufeed.org/v/schulart/grundschule'],
        ['ekw:schoolType:prefLabel:de', 'Grundschule (1–4)'],
        ['ekw:schoolType:type', 'Concept'],
        ['ekw:didacticConcept:id', 'https://edufeed.org/v/didaktisches-konzept/symboldidaktik'],
        ['ekw:didacticConcept:prefLabel:de', 'Symboldidaktik / Symbollernen'],
        ['ekw:didacticConcept:type', 'Concept'],
        ['ekw:method:id', 'https://edufeed.org/v/methode/rollenspiel'],
        ['ekw:method:prefLabel:de', 'Rollenspiel'],
        ['ekw:method:type', 'Concept'],
        ['ekw:methodOther', 'Freie Methode A'],
        ['ekw:methodOther', 'Freie Methode B'],
        ['ekw:bibleReference', 'Mt 5,3–12'],
        ['ekw:bibleReference', 'Joh 3,16']
      ]
    };

    const parsed = parseEkwTagsToFormData(event);

    expect(parsed.gradeLevels).toEqual(['https://edufeed.org/v/klassenstufen/5-6']);
    expect(parsed.gradeLevelLabels).toEqual([
      { id: 'https://edufeed.org/v/klassenstufen/5-6', label: '5–6' }
    ]);
    expect(parsed.schoolTypes).toEqual(['https://edufeed.org/v/schulart/grundschule']);
    expect(parsed.didacticConcepts).toEqual([
      'https://edufeed.org/v/didaktisches-konzept/symboldidaktik'
    ]);
    expect(parsed.methods).toEqual(['https://edufeed.org/v/methode/rollenspiel']);
    expect(parsed.methodOther).toBe('Freie Methode A\nFreie Methode B');
    expect(parsed.bibleReferences).toEqual(['Mt 5,3–12', 'Joh 3,16']);
  });

  it('prefers ext:ekw:* over legacy ekw:* when both are present', () => {
    const event = {
      tags: [
        ['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/old'],
        ['ekw:gradeLevel:prefLabel:de', 'Old Label'],
        ['ext:ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/new'],
        ['ext:ekw:gradeLevel:prefLabel:de', 'New Label']
      ]
    };

    const parsed = parseEkwTagsToFormData(event);

    expect(parsed.gradeLevels).toEqual(['https://edufeed.org/v/klassenstufen/new']);
    expect(parsed.gradeLevelLabels).toEqual([
      { id: 'https://edufeed.org/v/klassenstufen/new', label: 'New Label' }
    ]);
  });

  it('returns empty fields for an event without EKW tags', () => {
    const parsed = parseEkwTagsToFormData({
      tags: [
        ['d', 'res-1'],
        ['name', 'Pythagoras']
      ]
    });

    expect(parsed.gradeLevels).toEqual([]);
    expect(parsed.schoolTypes).toEqual([]);
    expect(parsed.didacticConcepts).toEqual([]);
    expect(parsed.methods).toEqual([]);
    expect(parsed.methodOther).toBe('');
    expect(parsed.bibleReferences).toEqual([]);
  });

  it('handles missing tags array safely', () => {
    expect(() => parseEkwTagsToFormData({ tags: [] })).not.toThrow();
    // @ts-expect-error - test runtime null safety
    expect(() => parseEkwTagsToFormData({})).not.toThrow();
  });
});
