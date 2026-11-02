/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getArticleCoverUrl, toCoverUrl } from '$lib/helpers/article-cover.js';

const URL_ = 'https://image.nostr.build/abc.jpg';

describe('toCoverUrl', () => {
  it('keeps an absolute http(s) URL', () => {
    expect(toCoverUrl(URL_)).toBe(URL_);
    expect(toCoverUrl('http://example.com/a.png')).toBe('http://example.com/a.png');
  });

  it('trims surrounding whitespace', () => {
    expect(toCoverUrl(`  ${URL_}\n`)).toBe(URL_);
  });

  // Seen on relay.edufeed.org (2 Nov 2026): a Markdown image pasted into the tag.
  it('takes the URL out of a Markdown image', () => {
    expect(toCoverUrl(`![image](${URL_})`)).toBe(URL_);
    expect(toCoverUrl(`![](${URL_} "Titel")`)).toBe(URL_);
  });

  // A bare filename would render as a relative <img> and 404 on our own origin.
  it.each([
    'jonny-gios-SqjhKY9877M-unsplash.jpg',
    '/images/cover.jpg',
    'not a url',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '![image](cover.jpg)',
    '',
    null,
    undefined
  ])('returns undefined for %j', (value) => {
    expect(toCoverUrl(value)).toBeUndefined();
  });
});

describe('getArticleCoverUrl', () => {
  /** @param {string[][]} tags */
  const article = (tags) => ({
    id: 'e'.repeat(64),
    kind: 30023,
    tags,
    content: '',
    pubkey: 'a'.repeat(64),
    created_at: 1700000000,
    sig: ''
  });

  it('reads the image tag', () => {
    expect(getArticleCoverUrl(article([['image', URL_]]))).toBe(URL_);
  });

  it('returns undefined without a usable image tag', () => {
    expect(getArticleCoverUrl(article([]))).toBeUndefined();
    expect(getArticleCoverUrl(article([['image', 'cover.jpg']]))).toBeUndefined();
    expect(getArticleCoverUrl(undefined)).toBeUndefined();
  });
});
