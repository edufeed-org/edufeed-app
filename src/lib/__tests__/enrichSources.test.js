/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { dedupeKeyFor, selectUploadedSourceUrls } from '$lib/helpers/educational/enrichSources.js';

describe('dedupeKeyFor', () => {
  it('is order-independent (sorts before joining)', () => {
    expect(dedupeKeyFor(['https://b/y', 'https://a/x'])).toBe(
      dedupeKeyFor(['https://a/x', 'https://b/y'])
    );
  });

  it('distinguishes different source sets', () => {
    expect(dedupeKeyFor(['https://a/x'])).not.toBe(dedupeKeyFor(['https://a/x', 'https://b/y']));
  });

  it('returns an empty string for an empty set', () => {
    expect(dedupeKeyFor([])).toBe('');
  });
});

describe('selectUploadedSourceUrls', () => {
  it('keeps files with a real http(s) URL', () => {
    const encodings = [
      { url: 'https://blossom.example/abc.pdf' },
      { url: 'http://blossom.example/def.pdf' }
    ];
    expect(selectUploadedSourceUrls(encodings)).toEqual([
      'https://blossom.example/abc.pdf',
      'http://blossom.example/def.pdf'
    ]);
  });

  it('excludes files whose upload has not completed (url is empty)', () => {
    const encodings = [{ url: '' }, { url: 'https://blossom.example/ready.pdf' }, {}];
    expect(selectUploadedSourceUrls(encodings)).toEqual(['https://blossom.example/ready.pdf']);
  });

  it('excludes non-http(s) URLs', () => {
    const encodings = [{ url: 'blob:abc' }, { url: 'data:application/pdf;base64,AAA' }];
    expect(selectUploadedSourceUrls(encodings)).toEqual([]);
  });

  it('handles a missing/undefined encodings array', () => {
    expect(selectUploadedSourceUrls(undefined)).toEqual([]);
    expect(selectUploadedSourceUrls(null)).toEqual([]);
  });

  it('returns both URLs when two files are ready', () => {
    const encodings = [
      { url: 'https://blossom.example/a.pdf' },
      { url: 'https://blossom.example/b.pdf' }
    ];
    expect(selectUploadedSourceUrls(encodings)).toHaveLength(2);
  });
});
