/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { sha256FromUrl } from '$lib/helpers/sha256.js';

const HASH = 'a'.repeat(64);

describe('sha256FromUrl', () => {
  it('reads the hash from a Blossom URL', () => {
    expect(sha256FromUrl(`https://blossom.example/${HASH}.jpg`)).toBe(HASH);
  });

  it('returns null for a URL without a hash', () => {
    expect(sha256FromUrl('https://example.com/cover.jpg')).toBeNull();
  });

  // Seen on live relays in kind 30023 `image` tags: a bare filename and a
  // Markdown image. applesauce's getSha256FromURL throws on both.
  it.each([
    'jonny-gios-SqjhKY9877M-unsplash.jpg',
    `![image](https://image.nostr.build/${HASH}.jpg)`,
    'not a url',
    ''
  ])('returns null instead of throwing for %j', (value) => {
    expect(sha256FromUrl(value)).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(sha256FromUrl(null)).toBeNull();
    expect(sha256FromUrl(undefined)).toBeNull();
  });
});
