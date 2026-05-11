/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getProxiedImageUrl } from '../helpers/image-proxy.js';

describe('getProxiedImageUrl', () => {
  it('returns undefined for falsy src', () => {
    expect(getProxiedImageUrl(null)).toBeUndefined();
    expect(getProxiedImageUrl(undefined)).toBeUndefined();
    expect(getProxiedImageUrl('')).toBeUndefined();
  });

  it('returns original src when no size is given', () => {
    const url = 'https://example.com/photo.jpg';
    expect(getProxiedImageUrl(url)).toBe(url);
  });

  it('builds proxy URL with preset name', () => {
    const url = 'https://example.com/photo.jpg';
    const result = getProxiedImageUrl(url, 'avatar_sm');
    expect(result).toBe('/api/image?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&w=64&h=64&q=80');
  });

  it('builds proxy URL with custom dimensions', () => {
    const url = 'https://example.com/photo.jpg';
    const result = getProxiedImageUrl(url, { w: 200, h: 100 });
    expect(result).toBe('/api/image?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&w=200&h=100&q=80');
  });

  it('respects custom quality', () => {
    const url = 'https://example.com/photo.jpg';
    const result = getProxiedImageUrl(url, 'card', 60);
    expect(result).toContain('q=60');
  });

  it('skips proxy for data URIs', () => {
    const dataUri = 'data:image/png;base64,abc123';
    expect(getProxiedImageUrl(dataUri, 'avatar_sm')).toBe(dataUri);
  });

  it('skips proxy for SVG files', () => {
    const svg = 'https://example.com/logo.svg';
    expect(getProxiedImageUrl(svg, 'card')).toBe(svg);
  });

  it('skips proxy for robohash URLs', () => {
    const robohash = 'https://robohash.org/abc123';
    expect(getProxiedImageUrl(robohash, 'avatar_sm')).toBe(robohash);
  });

  it('skips proxy for non-http URLs', () => {
    const blob = 'blob:http://localhost/abc';
    expect(getProxiedImageUrl(blob, 'card')).toBe(blob);
  });

  it('skips proxy for emoji preset (preserves animation in GIF/APNG/animated WebP)', () => {
    const gif = 'https://example.com/party-parrot.gif';
    expect(getProxiedImageUrl(gif, 'emoji')).toBe(gif);
    const apng = 'https://example.com/anim.png';
    expect(getProxiedImageUrl(apng, 'emoji')).toBe(apng);
    const webp = 'https://example.com/anim.webp';
    expect(getProxiedImageUrl(webp, 'emoji')).toBe(webp);
  });

  it('returns original src for unknown preset name', () => {
    const url = 'https://example.com/photo.jpg';
    expect(getProxiedImageUrl(url, 'nonexistent')).toBe(url);
  });

  it('handles all preset names', () => {
    const url = 'https://example.com/photo.jpg';
    const presets = ['avatar_sm', 'avatar_md', 'avatar_lg', 'thumbnail', 'card', 'banner', 'hero'];
    for (const preset of presets) {
      const result = getProxiedImageUrl(url, preset);
      expect(result).toContain('/api/image?');
      expect(result).toContain('url=');
      expect(result).toContain('w=');
      expect(result).toContain('h=');
    }
  });

  it('encodes special characters in URLs', () => {
    const url = 'https://example.com/photo with spaces.jpg?foo=bar&baz=qux';
    const result = getProxiedImageUrl(url, 'card');
    expect(result).toContain('/api/image?');
    // The URL should be properly encoded in the query param
    const params = new URLSearchParams(/** @type {string} */ (result).split('?')[1]);
    expect(params.get('url')).toBe(url);
  });
});
