/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { citationToPublicationPrefill } from '$lib/helpers/publication/urlMetadata.js';

describe('citationToPublicationPrefill', () => {
  it('maps citation metadata to publication form fields', () => {
    const prefill = citationToPublicationPrefill({
      source: 'opengraph',
      og: { title: 'OG Title', description: 'OG description' },
      citation: {
        title: 'Article Title',
        authors: [{ name: 'Lars Wosnitza', institution: 'Universität Bonn' }, { name: 'B' }],
        doi: '10.25364/10.34:2026.1.2',
        date: '2026-05-18',
        journal: 'ÖRF',
        language: 'de',
        keywords: ['Forschendes Lernen'],
        abstract: 'Abstract text.'
      }
    });
    expect(prefill).toEqual({
      title: 'Article Title',
      creators: [
        { name: 'Lars Wosnitza', type: 'Person', affiliationName: 'Universität Bonn' },
        { name: 'B', type: 'Person' }
      ],
      doi: '10.25364/10.34:2026.1.2',
      datePublished: '2026-05-18',
      journal: 'ÖRF',
      inLanguage: 'de',
      keywords: ['Forschendes Lernen'],
      abstract: 'Abstract text.'
    });
  });

  it('falls back to opengraph title/description when citation lacks them', () => {
    const prefill = citationToPublicationPrefill({
      source: 'opengraph',
      og: { title: 'OG Title', description: 'OG description' },
      citation: { authors: [], keywords: [] }
    });
    expect(prefill.title).toBe('OG Title');
    expect(prefill.abstract).toBe('OG description');
  });

  it('normalizes locale-style language codes to 2 letters', () => {
    const prefill = citationToPublicationPrefill({
      source: 'none',
      citation: { language: 'de_DE', authors: [], keywords: [] }
    });
    expect(prefill.inLanguage).toBe('de');
  });

  it('drops invalid DOIs instead of prefilling garbage', () => {
    const prefill = citationToPublicationPrefill({
      source: 'none',
      citation: { doi: 'not-a-doi', authors: [], keywords: [] }
    });
    expect(prefill.doi).toBeUndefined();
  });

  it('returns {} for metadata without citation or og', () => {
    expect(citationToPublicationPrefill({ source: 'none' })).toEqual({});
  });
});
