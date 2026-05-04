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
});
