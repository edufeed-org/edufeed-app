/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  ambJsonLdToPrefillEvent,
  ogToFormDataPrefill
} from '$lib/helpers/educational/ambJsonLdToFormData.js';
import {
  getAMBName,
  getAMBDescription,
  getAMBLearningResourceTypes,
  getAMBSubjects,
  getAMBLanguages
} from '$lib/helpers/educational/ambHelpers.js';

const sampleAmb = {
  '@context': 'https://w3id.org/kim/amb/context.jsonld',
  type: ['LearningResource', 'CreativeWork'],
  id: 'https://example.org/lesson/42',
  name: 'Photosynthesis',
  description: 'A short lesson about photosynthesis',
  inLanguage: ['de'],
  learningResourceType: [
    {
      id: 'https://w3id.org/kim/hcrt/text',
      type: 'Concept',
      prefLabel: { de: 'Text', en: 'Text' }
    }
  ],
  about: [
    {
      id: 'https://w3id.org/kim/hochschulfaechersystematik/n42',
      type: 'Concept',
      prefLabel: { de: 'Biologie', en: 'Biology' }
    }
  ]
};

describe('ambJsonLdToPrefillEvent', () => {
  it('returns null for invalid input', () => {
    expect(ambJsonLdToPrefillEvent(null)).toBeNull();
    expect(ambJsonLdToPrefillEvent(undefined)).toBeNull();
    expect(ambJsonLdToPrefillEvent({})).toBeNull();
  });

  it('produces an event whose tags are readable by getAMB* helpers', () => {
    const event = /** @type {any} */ (ambJsonLdToPrefillEvent(sampleAmb));
    expect(event).not.toBeNull();
    expect(event.kind).toBe(30142);
    expect(Array.isArray(event.tags)).toBe(true);

    expect(getAMBName(event)).toBe('Photosynthesis');
    expect(getAMBDescription(event)).toBe('A short lesson about photosynthesis');
    expect(getAMBLanguages(event)).toContain('de');

    const lrts = getAMBLearningResourceTypes(event, 'de');
    expect(lrts.length).toBeGreaterThan(0);
    expect(lrts[0].id).toBe('https://w3id.org/kim/hcrt/text');

    const subjects = getAMBSubjects(event, 'de');
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects[0].id).toBe('https://w3id.org/kim/hochschulfaechersystematik/n42');
  });
});

describe('ogToFormDataPrefill', () => {
  it('maps og fields to form data shape', () => {
    expect(
      ogToFormDataPrefill({
        title: 'A title',
        description: 'A description',
        image: 'https://example.org/img.png',
        locale: 'de_DE'
      })
    ).toEqual({
      name: 'A title',
      description: 'A description',
      image: 'https://example.org/img.png',
      inLanguage: 'de'
    });
  });

  it('omits unset fields rather than emitting empty strings', () => {
    expect(ogToFormDataPrefill({ title: 'Only a title' })).toEqual({ name: 'Only a title' });
  });

  it('normalizes og:locale "de-AT" / "de_DE" / "de" to "de"', () => {
    expect(ogToFormDataPrefill({ locale: 'de_DE' }).inLanguage).toBe('de');
    expect(ogToFormDataPrefill({ locale: 'de-AT' }).inLanguage).toBe('de');
    expect(ogToFormDataPrefill({ locale: 'de' }).inLanguage).toBe('de');
  });

  it('returns an empty object for an empty input', () => {
    expect(ogToFormDataPrefill({})).toEqual({});
  });
});
