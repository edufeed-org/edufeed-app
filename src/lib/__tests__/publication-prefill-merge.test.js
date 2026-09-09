/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { mergePublicationPrefill } from '$lib/helpers/publication/prefill-merge.js';

const empty = {
  title: '',
  creators: [],
  doi: '',
  datePublished: '',
  journal: '',
  abstract: '',
  keywords: [],
  inLanguage: 'de',
  fileUrl: '',
  hasUploads: false
};

/** @type {import('$lib/helpers/publication/crossref.js').DoiPrefill} */
const prefill = {
  title: 'T',
  creators: [{ name: 'A', type: 'Person' }],
  doi: '10.1000/x',
  datePublished: '2024-01-02',
  journal: 'J',
  abstract: 'Abs',
  keywords: ['k'],
  inLanguage: 'en',
  file: { url: 'https://x/y.pdf', mimeType: 'application/pdf' }
};

describe('mergePublicationPrefill', () => {
  it('fills every empty field and reports that something was applied', () => {
    const { patch, applied } = mergePublicationPrefill(empty, prefill);
    expect(patch).toEqual({
      title: 'T',
      creators: [{ name: 'A', type: 'Person' }],
      doi: '10.1000/x',
      datePublished: '2024-01-02',
      journal: 'J',
      abstract: 'Abs',
      keywords: ['k'],
      inLanguage: 'en',
      file: { url: 'https://x/y.pdf', mimeType: 'application/pdf' }
    });
    expect(applied).toBe(true);
  });

  it('leaves filled fields alone, including whitespace-only text it treats as empty', () => {
    const current = { ...empty, title: 'Mine', creators: [{ name: 'Me' }], journal: '   ' };
    const { patch } = mergePublicationPrefill(current, prefill);
    expect(patch.title).toBeUndefined();
    expect(patch.creators).toBeUndefined();
    expect(patch.journal).toBe('J');
  });

  it('does not attach a file when a URL or an upload already exists', () => {
    expect(
      mergePublicationPrefill({ ...empty, fileUrl: 'https://a' }, prefill).patch.file
    ).toBeUndefined();
    expect(
      mergePublicationPrefill({ ...empty, hasUploads: true }, prefill).patch.file
    ).toBeUndefined();
  });

  it('language is the one field that follows the source even when set, but never counts as applied', () => {
    const { patch, applied } = mergePublicationPrefill(
      { ...empty, title: 'x' },
      { inLanguage: 'fr' }
    );
    expect(patch).toEqual({ inLanguage: 'fr' });
    expect(applied).toBe(false);
  });

  it('an empty prefill yields an empty patch', () => {
    expect(mergePublicationPrefill(empty, {})).toEqual({ patch: {}, applied: false });
  });
});
