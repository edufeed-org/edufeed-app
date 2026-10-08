/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { helpLinkAttrs } from '$lib/helpers/help-link.js';

describe('helpLinkAttrs', () => {
  it('returns null when no help url is configured', () => {
    expect(helpLinkAttrs(null)).toBeNull();
    expect(helpLinkAttrs(undefined)).toBeNull();
    expect(helpLinkAttrs('')).toBeNull();
  });

  it('keeps in-app paths as plain same-tab links', () => {
    expect(helpLinkAttrs('/wiki/edufeed-erste-schritte')).toEqual({
      href: '/wiki/edufeed-erste-schritte'
    });
  });

  it('opens absolute URLs in a new tab without a referrer', () => {
    expect(helpLinkAttrs('https://example.org/hilfe')).toEqual({
      href: 'https://example.org/hilfe',
      target: '_blank',
      rel: 'noopener noreferrer'
    });
  });
});
