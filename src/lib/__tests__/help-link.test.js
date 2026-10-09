/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { helpLinkAttrs, helpSectionLinkAttrs } from '$lib/helpers/help-link.js';

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

describe('helpSectionLinkAttrs', () => {
  it('returns null when no help url is configured', () => {
    expect(helpSectionLinkAttrs(null, 'was-bedeutet-verifiziert')).toBeNull();
    expect(helpSectionLinkAttrs('', 'was-bedeutet-verifiziert')).toBeNull();
  });

  it('appends the section anchor to an in-app guide path', () => {
    expect(
      helpSectionLinkAttrs('/wiki/edufeed-erste-schritte', 'was-bedeutet-verifiziert')
    ).toEqual({ href: '/wiki/edufeed-erste-schritte#was-bedeutet-verifiziert' });
  });

  it('appends the anchor to an external guide and keeps the new-tab attributes', () => {
    expect(helpSectionLinkAttrs('https://example.org/hilfe', 'verifiziert')).toEqual({
      href: 'https://example.org/hilfe#verifiziert',
      target: '_blank',
      rel: 'noopener noreferrer'
    });
  });

  it('replaces an anchor the configured url already carries', () => {
    expect(helpSectionLinkAttrs('/wiki/guide#top', 'verifiziert')).toEqual({
      href: '/wiki/guide#verifiziert'
    });
  });
});
