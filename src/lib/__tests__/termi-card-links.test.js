/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { linkFor, externalLink } from '$lib/components/assistant/cards/links.js';

const EXT = { target: '_blank', rel: 'noopener noreferrer' };

describe('termi card links', () => {
  it('in-app paths stay in the tab', () => {
    expect(linkFor({ href: '/c/npub1abc' })).toEqual({ href: '/c/npub1abc' });
  });

  it('external http(s) links open in a new tab, href first, then sourceUrl', () => {
    expect(linkFor({ href: 'https://example.org/p' })).toEqual({
      href: 'https://example.org/p',
      ...EXT
    });
    expect(linkFor({ sourceUrl: 'http://example.org/x' })).toEqual({
      href: 'http://example.org/x',
      ...EXT
    });
  });

  it('protocol-relative, javascript: and data: links give nothing', () => {
    expect(linkFor({ href: '//evil.example/x' })).toBeUndefined();
    expect(linkFor({ href: 'javascript:alert(1)' })).toBeUndefined();
    expect(linkFor({ href: 'data:text/html,x', sourceUrl: 'javascript:x' })).toBeUndefined();
    expect(linkFor({})).toBeUndefined();
  });

  it('externalLink only takes http(s)', () => {
    expect(externalLink('https://example.org')).toEqual({ href: 'https://example.org', ...EXT });
    expect(externalLink('/intern')).toBeUndefined();
    expect(externalLink(undefined)).toBeUndefined();
  });
});
