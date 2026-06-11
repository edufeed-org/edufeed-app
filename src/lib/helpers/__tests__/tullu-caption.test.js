/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// Mock paraglide message accessors so tests are deterministic regardless of
// active locale.
vi.mock('$lib/paraglide/messages', () => ({
  tullu_by: () => 'by',
  tullu_source: () => 'source',
  tullu_no_title: () => 'untitled'
}));

const { buildTulluCaption } = await import('../tullu-caption.js');

/**
 * @param {string} licenseUrl
 * @param {Record<string, string>} extras
 */
function mkEvent(licenseUrl, extras = {}) {
  return {
    kind: 1063,
    pubkey: 'test-pubkey',
    content: extras.description || '',
    tags: [
      ['license', licenseUrl],
      ...Object.entries(extras)
        .filter(([k]) => k !== 'description')
        .map(([k, v]) => [k, v])
    ]
  };
}

describe('buildTulluCaption', () => {
  it('returns empty string for null event', () => {
    expect(buildTulluCaption(null)).toBe('');
  });

  it('returns empty string for event without license URL', () => {
    const ev = { tags: [['credit', 'Jane']] };
    expect(buildTulluCaption(ev)).toBe('');
  });

  it('builds the canonical TULLU caption with all fields', () => {
    const ev = mkEvent('https://creativecommons.org/licenses/by/4.0/', {
      credit: 'Max Mustermann',
      source: 'https://example.com/image.jpg',
      description: 'Bildtitel'
    });
    const result = buildTulluCaption(ev);
    expect(result).toBe(
      '*"Bildtitel", by Max Mustermann, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), source: https://example.com/image.jpg*'
    );
  });

  it('falls back to the alt option when description is empty', () => {
    const ev = mkEvent('https://creativecommons.org/licenses/by-sa/4.0/', {
      credit: 'Acme'
    });
    const result = buildTulluCaption(ev, { alt: 'screenshot.png' });
    expect(result).toBe(
      '*"screenshot.png", by Acme, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)*'
    );
  });

  it('falls back to no-title placeholder when both description and alt are missing', () => {
    const ev = mkEvent('https://creativecommons.org/publicdomain/zero/1.0/', {
      credit: 'Anon'
    });
    const result = buildTulluCaption(ev);
    expect(result).toBe(
      '*"untitled", by Anon, [CC0 (Public Domain)](https://creativecommons.org/publicdomain/zero/1.0/)*'
    );
  });

  it('omits the by-credit clause when no credit tag is present', () => {
    const ev = mkEvent('https://creativecommons.org/licenses/by/4.0/');
    const result = buildTulluCaption(ev, { alt: 'photo' });
    expect(result).toBe('*"photo", [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)*');
  });

  it('omits the source clause when no source tag is present', () => {
    const ev = mkEvent('https://creativecommons.org/licenses/by/4.0/', {
      credit: 'Jane'
    });
    const result = buildTulluCaption(ev, { alt: 'photo' });
    expect(result).toBe(
      '*"photo", by Jane, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)*'
    );
  });

  it('prefers an explicit title tag over content and alt', () => {
    const ev = mkEvent('https://creativecommons.org/licenses/by/4.0/', {
      credit: 'Jane',
      description: 'A picture of a cat sitting on a wall'
    });
    ev.tags.push(['title', 'Cat on Wall']);
    const result = buildTulluCaption(ev, { alt: 'fallback.jpg' });
    expect(result).toContain('"Cat on Wall"');
    expect(result).not.toContain('A picture of a cat');
    expect(result).not.toContain('fallback.jpg');
  });

  it('uses the raw URL as label when formatLicenseUrl does not recognize it', () => {
    const ev = mkEvent('https://example.com/custom-license', {
      credit: 'Org'
    });
    const result = buildTulluCaption(ev, { alt: 'pic' });
    expect(result).toContain(
      '[https://example.com/custom-license](https://example.com/custom-license)'
    );
  });
});
