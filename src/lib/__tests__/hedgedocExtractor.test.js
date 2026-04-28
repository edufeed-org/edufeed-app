// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { isHedgedocPage, extractHedgedocArticle } from '$lib/helpers/hedgedocExtractor.js';

describe('isHedgedocPage', () => {
  it('detects HedgeDoc via the application-name meta tag', () => {
    const html = `<!doctype html><html><head>
      <meta name="application-name" content="HedgeDoc - Ideas grow better together">
    </head><body></body></html>`;
    const { document } = parseHTML(html);
    expect(isHedgedocPage(document)).toBe(true);
  });

  it('detects HedgeDoc via the #doc.markdown-body container', () => {
    const html = `<html><body>
      <div id="doc" class="container markdown-body"># Hello</div>
    </body></html>`;
    const { document } = parseHTML(html);
    expect(isHedgedocPage(document)).toBe(true);
  });

  it('returns false for unrelated pages', () => {
    const html = `<html><head><title>Some page</title></head>
      <body><article><p>Hello</p></article></body></html>`;
    const { document } = parseHTML(html);
    expect(isHedgedocPage(document)).toBe(false);
  });
});

describe('extractHedgedocArticle', () => {
  it('renders the raw markdown body into HTML', () => {
    const html = `<html><head>
      <meta property="og:title" content="My Note - HedgeDoc">
    </head><body>
      <div id="doc" class="container markdown-body"># Hello

**bold** [link](https://example.com)</div>
    </body></html>`;
    const { document } = parseHTML(html);

    const result = extractHedgedocArticle(document, new URL('https://pad.example.com/abc'));

    expect(result).not.toBeNull();
    expect(result.title).toBe('My Note');
    expect(result.content).toContain('<h1');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('<strong>bold</strong>');
    expect(result.content).toContain('<a href="https://example.com">link</a>');
    expect(result.textContent).toContain('# Hello');
    expect(result.siteName).toBe('HedgeDoc');
  });

  it('falls back to the first H1 when og:title is missing', () => {
    const html = `<html><body>
      <div id="doc" class="markdown-body"># My Title

content</div>
    </body></html>`;
    const { document } = parseHTML(html);
    const result = extractHedgedocArticle(document, new URL('https://pad.example.com/abc'));
    expect(result.title).toBe('My Title');
  });

  it('strips the " - HedgeDoc" suffix from og:title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Just A Title - HedgeDoc">
    </head><body>
      <div id="doc" class="markdown-body">body</div>
    </body></html>`;
    const { document } = parseHTML(html);
    const result = extractHedgedocArticle(document, new URL('https://pad.example.com/abc'));
    expect(result.title).toBe('Just A Title');
  });

  it('returns null when there is no #doc.markdown-body element', () => {
    const html = `<html><body><div>no doc</div></body></html>`;
    const { document } = parseHTML(html);
    expect(extractHedgedocArticle(document, new URL('https://example.com/'))).toBeNull();
  });

  it('decodes HTML entities in the extracted markdown', () => {
    const html = `<html><body>
      <div id="doc" class="markdown-body">Arrow: -&gt; &amp; ampersand</div>
    </body></html>`;
    const { document } = parseHTML(html);
    const result = extractHedgedocArticle(document, new URL('https://example.com/'));
    expect(result.textContent).toContain('-> & ampersand');
    expect(result.content).toContain('-&gt; &amp; ampersand');
  });
});
