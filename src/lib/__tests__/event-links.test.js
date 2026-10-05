/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { splitEventLinks } from '$lib/helpers/event-links.js';

describe('splitEventLinks', () => {
  it('returns no primary link and no others for empty input', () => {
    expect(splitEventLinks([])).toEqual({ primary: null, others: [] });
    expect(splitEventLinks(undefined)).toEqual({ primary: null, others: [] });
    expect(splitEventLinks(null)).toEqual({ primary: null, others: [] });
  });

  it('promotes the first http(s) reference to the primary link with its host', () => {
    const result = splitEventLinks([
      'https://www.example.org/barcamp-2026',
      'https://docs.example.org/slides.pdf'
    ]);
    expect(result.primary).toEqual({
      url: 'https://www.example.org/barcamp-2026',
      host: 'example.org'
    });
    expect(result.others).toEqual(['https://docs.example.org/slides.pdf']);
  });

  it('accepts plain http links', () => {
    expect(splitEventLinks(['http://event.example.com']).primary).toEqual({
      url: 'http://event.example.com',
      host: 'event.example.com'
    });
  });

  it('falls back to listing everything when the first reference is not http(s)', () => {
    const refs = ['mailto:info@example.org', 'https://example.org'];
    expect(splitEventLinks(refs)).toEqual({ primary: null, others: refs });
  });

  it('does not promote a later link when the first one is unusable', () => {
    expect(splitEventLinks(['not a url', 'https://example.org']).primary).toBeNull();
  });

  it('rejects javascript: and other schemes', () => {
    expect(splitEventLinks(['javascript:alert(1)']).primary).toBeNull();
    expect(splitEventLinks(['ftp://example.org/file']).primary).toBeNull();
  });

  it('dedupes repeated r-tags and never lists the primary link twice', () => {
    const result = splitEventLinks([
      'https://example.org',
      'https://example.org',
      'https://other.example.org',
      'https://other.example.org'
    ]);
    expect(result.primary?.url).toBe('https://example.org');
    expect(result.others).toEqual(['https://other.example.org']);
  });

  it('ignores blank and non-string entries', () => {
    expect(splitEventLinks(['  ', 'https://example.org', 42])).toEqual({
      primary: { url: 'https://example.org', host: 'example.org' },
      others: []
    });
  });
});
