/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { extractPreviewableUrls } from '$lib/helpers/linkPreview.js';

/** @param {Array<any>} children */
function root(children) {
  return { type: 'root', children };
}

/** @param {string} href @param {string} [value] */
function link(href, value = href) {
  return { type: 'link', href, value };
}

describe('extractPreviewableUrls', () => {
  it('returns an empty array for a tree with no link nodes', () => {
    const tree = root([{ type: 'text', value: 'hello' }]);
    expect(extractPreviewableUrls(tree)).toEqual([]);
  });

  it('returns plain HTTP and HTTPS URLs', () => {
    const tree = root([link('http://example.com'), link('https://example.org/page')]);
    expect(extractPreviewableUrls(tree)).toEqual([
      'http://example.com',
      'https://example.org/page'
    ]);
  });

  it('excludes URLs ending in image extensions', () => {
    const tree = root([
      link('https://x.test/a.jpg'),
      link('https://x.test/a.jpeg'),
      link('https://x.test/a.png'),
      link('https://x.test/a.gif'),
      link('https://x.test/a.webp'),
      link('https://x.test/a.svg'),
      link('https://x.test/a.avif'),
      link('https://x.test/a.bmp'),
      link('https://x.test/article')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/article']);
  });

  it('excludes URLs ending in video extensions', () => {
    const tree = root([
      link('https://x.test/a.mp4'),
      link('https://x.test/a.webm'),
      link('https://x.test/a.mov'),
      link('https://x.test/a.ogg'),
      link('https://x.test/article')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/article']);
  });

  it('excludes image/video URLs with a query string suffix', () => {
    const tree = root([
      link('https://x.test/a.jpg?w=200'),
      link('https://x.test/a.mp4?t=10'),
      link('https://x.test/page?id=1')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/page?id=1']);
  });

  it('excludes nostr: and web+nostr: URIs', () => {
    const tree = root([
      link('nostr:nevent1abc'),
      link('web+nostr:nevent1abc'),
      link('https://x.test/article')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/article']);
  });

  it('excludes non-HTTP schemes (mailto, ftp, etc.)', () => {
    const tree = root([
      link('mailto:foo@example.com'),
      link('ftp://x.test/file'),
      link('javascript:alert(1)'),
      link('https://x.test/article')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/article']);
  });

  it('deduplicates repeated URLs, preserving first occurrence order', () => {
    const tree = root([
      link('https://a.test'),
      { type: 'text', value: ' and ' },
      link('https://b.test'),
      link('https://a.test')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://a.test', 'https://b.test']);
  });

  it('caps the result at 3 URLs', () => {
    const tree = root([
      link('https://a.test'),
      link('https://b.test'),
      link('https://c.test'),
      link('https://d.test'),
      link('https://e.test')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual([
      'https://a.test',
      'https://b.test',
      'https://c.test'
    ]);
  });

  it('preserves document order', () => {
    const tree = root([
      { type: 'text', value: 'see ' },
      link('https://second.test'),
      { type: 'text', value: ' before ' },
      link('https://first.test')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://second.test', 'https://first.test']);
  });

  it('ignores non-link nodes (text, emoji, mention, hashtag, gallery)', () => {
    const tree = root([
      { type: 'text', value: 'hello' },
      { type: 'emoji', code: 'fire', url: 'https://x.test/fire.png' },
      { type: 'mention', encoded: 'npub1abc' },
      { type: 'hashtag', name: 'topic' },
      { type: 'gallery', links: ['https://x.test/img.png'] },
      link('https://x.test/page')
    ]);
    expect(extractPreviewableUrls(tree)).toEqual(['https://x.test/page']);
  });

  it('returns an empty array when input is null or undefined', () => {
    expect(extractPreviewableUrls(null)).toEqual([]);
    expect(extractPreviewableUrls(undefined)).toEqual([]);
    expect(extractPreviewableUrls({})).toEqual([]);
  });
});
