/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildResourceData } from '$lib/helpers/educational/buildResourceData.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';

/**
 * Minimal filled wizard formData for assembling resourceData.
 * @returns {ReturnType<typeof createInitialFormData>}
 */
function filledFormData() {
  return /** @type {any} */ ({
    ...createInitialFormData(),
    name: 'Titel',
    description: 'Beschreibung',
    identifier: 'https://example.org/lesson',
    inLanguage: 'de',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/slide', label: 'Präsentation' }],
    educationalLevels: [{ id: 'https://w3id.org/kim/educationalLevel/level_1', label: 'Primar' }],
    keywords: ['Resilienz'],
    creators: [{ name: 'Corinna', type: 'Person' }],
    encodings: [
      {
        url: 'https://blossom.example/a93.pdf',
        name: 'a93.pdf',
        type: 'application/pdf',
        size: 1,
        sha256: 'a93'
      }
    ],
    image: 'https://blossom.example/2d39.png',
    imageLicenseEvent: { kind: 1063, tags: [['x', '2d39']] },
    datePublished: '2026-07-01',
    dateCreated: '2026-06-15',
    teaches: [{ id: 'https://lehrplan.example/1', type: 'Concept', prefLabel: { de: 'Thema' } }],
    assesses: [{ id: 'https://lehrplan.example/2', type: 'Concept', prefLabel: { de: 'Test' } }],
    competencyRequired: [
      { id: 'https://lehrplan.example/3', type: 'Concept', prefLabel: { de: 'Basis' } }
    ]
  });
}

const about = [{ id: 'http://w3id.org/kim/schulfaecher/s1055', label: 'Religion' }];

describe('buildResourceData', () => {
  it('passes image + license event through so the image and x tags can be emitted', () => {
    const rd = buildResourceData(filledFormData(), { about, konfiTags: [], hasNoUrl: false });
    expect(rd.image).toBe('https://blossom.example/2d39.png');
    expect(rd.imageLicenseEvent).toEqual({ kind: 1063, tags: [['x', '2d39']] });
  });

  it('passes datePublished and dateCreated through', () => {
    const rd = buildResourceData(filledFormData(), { about, konfiTags: [], hasNoUrl: false });
    expect(rd.datePublished).toBe('2026-07-01');
    expect(rd.dateCreated).toBe('2026-06-15');
  });

  it('passes curriculum relations (teaches/assesses/competencyRequired) through', () => {
    const rd = buildResourceData(filledFormData(), { about, konfiTags: [], hasNoUrl: false });
    expect(rd.teaches).toHaveLength(1);
    expect(rd.assesses).toHaveLength(1);
    expect(rd.competencyRequired).toHaveLength(1);
    expect(rd.teaches[0].id).toBe('https://lehrplan.example/1');
  });

  it('keeps the existing field mapping intact', () => {
    const rd = buildResourceData(filledFormData(), { about, konfiTags: [], hasNoUrl: false });
    expect(rd.name).toBe('Titel');
    expect(rd.slug).toBe('https://example.org/lesson');
    expect(rd.learningResourceType).toBe('https://w3id.org/kim/hcrt/slide');
    expect(rd.about).toEqual(['http://w3id.org/kim/schulfaecher/s1055']);
    expect(rd.aboutLabels).toEqual(about);
    expect(rd.educationalLevels).toEqual(['https://w3id.org/kim/educationalLevel/level_1']);
    expect(rd.files).toHaveLength(1);
    expect(rd.creators).toHaveLength(1);
  });

  it('sends an empty slug for no-URL resources (random d-tag downstream)', () => {
    const rd = buildResourceData(filledFormData(), { about, konfiTags: [], hasNoUrl: true });
    expect(rd.slug).toBe('');
  });

  it('forwards konfiTags verbatim', () => {
    const konfiTags = [['L', 'https://edufeed.org/ns/bildungsbereich#']];
    const rd = buildResourceData(filledFormData(), { about, konfiTags, hasNoUrl: false });
    expect(rd.konfiTags).toEqual(konfiTags);
  });
});
