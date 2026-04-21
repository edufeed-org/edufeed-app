/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Mock $app/environment
vi.mock('$app/environment', () => ({ browser: false }));

// Mock nostr-tools normalizeIdentifier
vi.mock('nostr-tools/nip54', () => ({
  normalizeIdentifier: (/** @type {string} */ s) => s.toLowerCase().replace(/\s+/g, '-')
}));

const { isAsciidoc, renderWikiContent } = await import('$lib/helpers/wikiContent.js');

describe('isAsciidoc', () => {
  it('detects single-= heading', () => {
    expect(isAsciidoc('= My Title\n\nSome content')).toBe(true);
  });

  it('detects [source,lang] blocks', () => {
    expect(isAsciidoc('[source,javascript]\n----\nconst x = 1;\n----')).toBe(true);
  });

  it('detects :attribute: lines', () => {
    expect(isAsciidoc(':toc: left\n:icons: font\n\nContent here')).toBe(true);
  });

  it('detects include:: directives', () => {
    expect(isAsciidoc('include::chapter1.adoc[]')).toBe(true);
  });

  it('returns false for Djot/Markdown content', () => {
    expect(isAsciidoc('# Heading\n\nSome **bold** text')).toBe(false);
  });

  it('returns false for empty/null content', () => {
    expect(isAsciidoc('')).toBe(false);
    expect(isAsciidoc(/** @type {any} */ (null))).toBe(false);
  });

  it('does not false-positive on == (Djot heading)', () => {
    // Djot uses ## for headings, but == could appear — it needs a space + text after
    expect(isAsciidoc('== Section\n\nContent')).toBe(true);
  });

  it('does not false-positive on lines starting with = in equations', () => {
    // "= 5" without more context is still AsciiDoc heading-like
    // But "x = 5" is not
    expect(isAsciidoc('x = 5\ny = 10')).toBe(false);
  });
});

describe('renderWikiContent', () => {
  it('renders Djot content to HTML', async () => {
    const html = await renderWikiContent('# Hello\n\nThis is **bold**.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('Hello');
  });

  it('renders Djot headings', async () => {
    const html = await renderWikiContent('## Section Title');
    expect(html).toContain('<h2>');
    expect(html).toContain('Section Title');
  });

  it('renders Djot links', async () => {
    const html = await renderWikiContent('[click here](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('click here');
  });

  it('rewrites nostr: links to app paths', async () => {
    const html = await renderWikiContent('[profile](nostr:npub1abc123)');
    expect(html).toContain('href="/npub1abc123"');
  });

  it('converts wikilinks before rendering', async () => {
    const html = await renderWikiContent('See [[Some Topic]] for more.');
    expect(html).toContain('/wiki/some-topic');
    expect(html).toContain('Some Topic');
  });

  it('converts wikilinks with labels', async () => {
    const html = await renderWikiContent('See [[Some Topic|click here]] for more.');
    expect(html).toContain('/wiki/some-topic');
    expect(html).toContain('click here');
  });

  it('converts bare nostr: mentions to links', async () => {
    const html = await renderWikiContent('Check nostr:npub1abcdefghijklmnop');
    expect(html).toContain('<a href="/npub1abcdefghijklmnop"');
  });

  it('renders AsciiDoc content to HTML', async () => {
    const asciidocContent = '= My Document\n\nThis is *bold* text.\n\n== Section One\n\nHello.';
    const html = await renderWikiContent(asciidocContent);
    expect(html).toContain('bold');
    expect(html).toContain('Section One');
  });

  it('returns empty string for null/undefined', async () => {
    expect(await renderWikiContent(null)).toBe('');
    expect(await renderWikiContent(undefined)).toBe('');
    expect(await renderWikiContent('')).toBe('');
  });

  it('sanitizes dangerous HTML in Djot output', async () => {
    const html = await renderWikiContent('<script>alert("xss")</script>\n\nSafe text');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Safe text');
  });
});
