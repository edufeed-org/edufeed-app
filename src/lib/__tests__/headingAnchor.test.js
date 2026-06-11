/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { slugifyHeading, createSlugger, headingAnchorLink } from '$lib/helpers/headingAnchor.js';

describe('slugifyHeading', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyHeading('Hello World')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugifyHeading('What is Nostr?')).toBe('what-is-nostr');
  });

  it('strips diacritics', () => {
    expect(slugifyHeading('Über uns')).toBe('uber-uns');
  });

  it('collapses consecutive whitespace and hyphens', () => {
    expect(slugifyHeading('a   --  b')).toBe('a-b');
  });

  it('returns empty string for empty/null input', () => {
    expect(slugifyHeading('')).toBe('');
    expect(slugifyHeading(/** @type {any} */ (null))).toBe('');
  });

  it('drops emoji and non-latin characters that have no ascii equivalent', () => {
    expect(slugifyHeading('🎉 Launch Day')).toBe('launch-day');
  });
});

describe('createSlugger', () => {
  it('returns the base slug on first use', () => {
    const slug = createSlugger();
    expect(slug('Intro')).toBe('intro');
  });

  it('dedupes repeated headings with -1, -2…', () => {
    const slug = createSlugger();
    expect(slug('Background')).toBe('background');
    expect(slug('Background')).toBe('background-1');
    expect(slug('Background')).toBe('background-2');
  });

  it('falls back to "section" for empty heading text', () => {
    const slug = createSlugger();
    expect(slug('')).toBe('section');
    expect(slug('???')).toBe('section-1');
  });

  it('does not collide across different sluggers', () => {
    const a = createSlugger();
    const b = createSlugger();
    expect(a('Foo')).toBe('foo');
    expect(b('Foo')).toBe('foo');
  });
});

describe('headingAnchorLink', () => {
  it('renders an anchor pointing at the id', () => {
    const html = headingAnchorLink('intro');
    expect(html).toContain('href="#intro"');
    expect(html).toContain('class="heading-anchor"');
    expect(html).toContain('aria-label=');
  });
});
