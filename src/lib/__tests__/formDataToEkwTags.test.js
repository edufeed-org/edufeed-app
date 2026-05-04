/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formDataToEkwTags } from '$lib/helpers/educational/formDataToEkwTags.js';
import { parseEkwTagsToFormData } from '$lib/helpers/educational/parseEkwTagsToFormData.js';

const sampleFormData = {
  gradeLevels: ['https://edufeed.org/v/klassenstufen/5-6'],
  gradeLevelLabels: [{ id: 'https://edufeed.org/v/klassenstufen/5-6', label: '5–6' }],
  schoolTypes: ['https://edufeed.org/v/schulart/grundschule'],
  schoolTypeLabels: [
    { id: 'https://edufeed.org/v/schulart/grundschule', label: 'Grundschule (1–4)' }
  ],
  didacticConcepts: ['https://edufeed.org/v/didaktisches-konzept/symboldidaktik'],
  didacticConceptLabels: [
    {
      id: 'https://edufeed.org/v/didaktisches-konzept/symboldidaktik',
      label: 'Symboldidaktik / Symbollernen'
    }
  ],
  methods: ['https://edufeed.org/v/methode/rollenspiel'],
  methodLabels: [{ id: 'https://edufeed.org/v/methode/rollenspiel', label: 'Rollenspiel' }],
  methodOther: 'Freie Methode A\nFreie Methode B\n',
  bibleReferences: ['Mt 5,3–12', 'Joh 3,16']
};

describe('formDataToEkwTags', () => {
  it('emits id + prefLabel + type tags for each vocab field', () => {
    const tags = formDataToEkwTags(sampleFormData);

    expect(tags).toContainEqual(['ekw:gradeLevel:id', 'https://edufeed.org/v/klassenstufen/5-6']);
    expect(tags).toContainEqual(['ekw:gradeLevel:prefLabel:de', '5–6']);
    expect(tags).toContainEqual(['ekw:gradeLevel:type', 'Concept']);

    expect(tags).toContainEqual([
      'ekw:schoolType:id',
      'https://edufeed.org/v/schulart/grundschule'
    ]);
    expect(tags).toContainEqual([
      'ekw:didacticConcept:id',
      'https://edufeed.org/v/didaktisches-konzept/symboldidaktik'
    ]);
    expect(tags).toContainEqual(['ekw:method:id', 'https://edufeed.org/v/methode/rollenspiel']);
  });

  it('emits one tag per non-empty methodOther line and per bibleReference', () => {
    const tags = formDataToEkwTags(sampleFormData);
    expect(tags).toContainEqual(['ekw:methodOther', 'Freie Methode A']);
    expect(tags).toContainEqual(['ekw:methodOther', 'Freie Methode B']);
    expect(tags.filter((t) => t[0] === 'ekw:methodOther')).toHaveLength(2);

    expect(tags).toContainEqual(['ekw:bibleReference', 'Mt 5,3–12']);
    expect(tags).toContainEqual(['ekw:bibleReference', 'Joh 3,16']);
  });

  it('returns empty array when no EKW data is present', () => {
    expect(
      formDataToEkwTags({
        gradeLevels: [],
        schoolTypes: [],
        didacticConcepts: [],
        methods: [],
        methodOther: '',
        bibleReferences: ['']
      })
    ).toEqual([]);
  });
});

describe('parseEkwTagsToFormData', () => {
  it('round-trips formDataToEkwTags output into the original formData fragment', () => {
    const tags = formDataToEkwTags(sampleFormData);
    const event = { tags };
    const parsed = parseEkwTagsToFormData(event);

    expect(parsed.gradeLevels).toEqual(sampleFormData.gradeLevels);
    expect(parsed.gradeLevelLabels).toEqual(sampleFormData.gradeLevelLabels);
    expect(parsed.schoolTypes).toEqual(sampleFormData.schoolTypes);
    expect(parsed.didacticConcepts).toEqual(sampleFormData.didacticConcepts);
    expect(parsed.methods).toEqual(sampleFormData.methods);
    expect(parsed.methodOther).toBe('Freie Methode A\nFreie Methode B');
    expect(parsed.bibleReferences).toEqual(['Mt 5,3–12', 'Joh 3,16']);
  });
});
