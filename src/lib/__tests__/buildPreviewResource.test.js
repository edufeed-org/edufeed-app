// @ts-nocheck
/**
 * buildPreviewResource — wizard live-preview adapter.
 *
 * Converts in-progress wizard formData into the same `resource` shape that
 * `AMBResourceCard` consumes when rendering published kind-30142 events.
 * The adapter must be tolerant of incomplete data: the preview is shown
 * while the user is still typing, so missing required fields (license,
 * subjects, …) must not throw.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildPreviewResource } from '../helpers/educational/buildPreviewResource.js';

const PUBKEY = '0'.repeat(64);

/** @returns {any} */
function emptyFormData() {
  return {
    name: '',
    description: '',
    image: '',
    inLanguage: '',
    license: '',
    slug: '',
    learningResourceType: '',
    about: [],
    aboutLabels: [],
    educationalLevel: [],
    educationalLevelLabels: [],
    keywords: [],
    creators: [],
    externalUrls: [],
    encodings: [],
    hasPart: [],
    isPartOf: []
  };
}

describe('buildPreviewResource', () => {
  it('returns null when the form has no displayable content yet', () => {
    expect(buildPreviewResource(emptyFormData(), PUBKEY)).toBeNull();
  });

  it('returns null for nullish formData', () => {
    expect(buildPreviewResource(null, PUBKEY)).toBeNull();
    expect(buildPreviewResource(undefined, PUBKEY)).toBeNull();
  });

  it('renders a title-only preview without throwing on missing required fields', () => {
    const formData = { ...emptyFormData(), name: 'Bruchrechnen — Einstieg' };
    const resource = buildPreviewResource(formData, PUBKEY);
    expect(resource).not.toBeNull();
    expect(resource.name).toBe('Bruchrechnen — Einstieg');
    expect(resource.kind).toBe(30142);
  });

  it('carries description and image through to the preview', () => {
    const formData = {
      ...emptyFormData(),
      name: 'Bruchrechnen',
      description: 'Eine Einführung in die Bruchrechnung.',
      image: 'https://example.org/img.jpg'
    };
    const resource = buildPreviewResource(formData, PUBKEY);
    expect(resource.description).toBe('Eine Einführung in die Bruchrechnung.');
    expect(resource.image).toBe('https://example.org/img.jpg');
  });

  it('reflects the chosen language', () => {
    const formData = {
      ...emptyFormData(),
      name: 'Test',
      inLanguage: 'de'
    };
    const resource = buildPreviewResource(formData, PUBKEY);
    expect(resource.languages).toContain('de');
  });

  it('uses the supplied pubkey on the synthetic event', () => {
    const formData = { ...emptyFormData(), name: 'Test' };
    const resource = buildPreviewResource(formData, PUBKEY);
    expect(resource.pubkey).toBe(PUBKEY);
  });

  it('falls back to a placeholder pubkey when none is supplied (anonymous preview)', () => {
    const formData = { ...emptyFormData(), name: 'Test' };
    const resource = buildPreviewResource(formData, undefined);
    expect(resource).not.toBeNull();
    expect(typeof resource.pubkey).toBe('string');
    expect(resource.pubkey.length).toBe(64);
  });

  it('produces the same shape that formatAMBResource would (rawEvent present)', () => {
    const formData = { ...emptyFormData(), name: 'Test', description: 'Desc' };
    const resource = buildPreviewResource(formData, PUBKEY);
    expect(resource.rawEvent).toBeDefined();
    expect(resource.rawEvent.kind).toBe(30142);
    expect(Array.isArray(resource.tags)).toBe(true);
  });

  it('normalizes CompactConcept[] learningResourceType to a string label, not "[object Object]"', () => {
    // Wizard stores learningResourceType as CompactConcept[] (array of {id,label})
    // but convertFormDataToAMB expects a plain string id.
    const formData = {
      ...emptyFormData(),
      name: 'Test',
      learningResourceType: [
        { id: 'https://w3id.org/kim/hcrt/application', label: 'Softwareanwendung' }
      ]
    };
    const resource = buildPreviewResource(formData, PUBKEY);
    // The card reads localizedLearningResourceTypes[0].label, derived from tags.
    // Both the id tag and the prefLabel tag must be clean strings.
    const idTag = resource.tags.find((t) => t[0] === 'learningResourceType:id');
    expect(idTag?.[1]).toBe('https://w3id.org/kim/hcrt/application');
    const labelTag = resource.tags.find((t) => t[0].startsWith('learningResourceType:prefLabel:'));
    expect(labelTag?.[1]).toBe('Softwareanwendung');
    expect(labelTag?.[1]).not.toContain('[object Object]');
    // The pre-resolved learningResourceTypes label field must be the human-readable string.
    const types = resource.learningResourceTypes ?? [];
    expect(types[0]?.label).toBe('Softwareanwendung');
  });

  it('normalizes CompactConcept[] educationalLevels to clean string tags, not "[object Object]"', () => {
    // Wizard stores educationalLevels as CompactConcept[] (array of {id,label})
    // but convertFormDataToAMB iterates them as URI strings — without
    // normalisation each tag becomes "[object Object]".
    const formData = {
      ...emptyFormData(),
      name: 'Test',
      educationalLevels: [
        { id: 'https://w3id.org/kim/educationalLevel/primary', label: 'Primarstufe' },
        { id: 'https://w3id.org/kim/educationalLevel/secondary_i', label: 'Sekundarstufe I' }
      ]
    };
    const resource = buildPreviewResource(formData, PUBKEY);
    const idTags = resource.tags.filter((t) => t[0] === 'educationalLevel:id');
    expect(idTags).toHaveLength(2);
    expect(idTags[0][1]).toBe('https://w3id.org/kim/educationalLevel/primary');
    expect(idTags[1][1]).toBe('https://w3id.org/kim/educationalLevel/secondary_i');
    for (const t of idTags) expect(t[1]).not.toContain('[object Object]');
    const labelTags = resource.tags.filter((t) => t[0].startsWith('educationalLevel:prefLabel:'));
    expect(labelTags.map((t) => t[1])).toEqual(
      expect.arrayContaining(['Primarstufe', 'Sekundarstufe I'])
    );
    for (const t of labelTags) expect(t[1]).not.toContain('[object Object]');
  });

  it('normalizes CompactConcept[] about to clean string tags, not "[object Object]"', () => {
    // Some callers may pass `about` as CompactConcept[]. Same risk as the
    // learningResourceType + educationalLevels case.
    const formData = {
      ...emptyFormData(),
      name: 'Test',
      about: [{ id: 'https://w3id.org/kim/schulfaecher/s1010', label: 'Mathematik' }]
    };
    const resource = buildPreviewResource(formData, PUBKEY);
    const idTags = resource.tags.filter((t) => t[0] === 'about:id');
    expect(idTags).toHaveLength(1);
    expect(idTags[0][1]).toBe('https://w3id.org/kim/schulfaecher/s1010');
    expect(idTags[0][1]).not.toContain('[object Object]');
    const labelTag = resource.tags.find((t) => t[0].startsWith('about:prefLabel:'));
    expect(labelTag?.[1]).toBe('Mathematik');
    expect(labelTag?.[1]).not.toContain('[object Object]');
  });
});

describe('buildPreviewResource — x tag', () => {
  it('emits x tag when imageLicenseEvent carries a hash', () => {
    const hash = 'a'.repeat(64);
    const r = buildPreviewResource(
      {
        name: 'Test',
        image: `https://blossom.example/${hash}.jpg`,
        imageLicenseEvent: {
          kind: 1063,
          tags: [
            ['url', `https://blossom.example/${hash}.jpg`],
            ['x', hash]
          ]
        }
      },
      'b'.repeat(64)
    );
    const xTag = r?.tags?.find((t) => t[0] === 'x');
    expect(xTag?.[1]).toBe(hash);
  });

  it('emits x tag for a pasted Blossom URL', () => {
    const hash = 'c'.repeat(64);
    const r = buildPreviewResource(
      { name: 'Test', image: `https://blossom.example/${hash}.jpg` },
      'b'.repeat(64)
    );
    const xTag = r?.tags?.find((t) => t[0] === 'x');
    expect(xTag?.[1]).toBe(hash);
  });

  it('does not emit x tag for a non-Blossom URL', () => {
    const r = buildPreviewResource(
      { name: 'Test', image: 'https://wikipedia.org/foo.jpg' },
      'b'.repeat(64)
    );
    const xTag = r?.tags?.find((t) => t[0] === 'x');
    expect(xTag).toBeUndefined();
  });
});
