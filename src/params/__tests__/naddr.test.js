/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { match } from '../naddr.js';

describe('naddr param matcher', () => {
  test('matches naddr without relay hints (~86 bech32 chars)', () => {
    const short =
      'naddr1qvzqqqr4gupzpxca23zkudsn7gsdq9nnhkss55p4ejwnd0e655uzaxgjq0h9m8ktqqyxxvmrwaj857rrkeney7';
    expect(match(short)).toBe(true);
  });

  test('matches naddr with relay hints', () => {
    const long =
      'naddr1qvzqqqr4gupzpxca23zkudsn7gsdq9nnhkss55p4ejwnd0e655uzaxgjq0h9m8ktqy88wumn8ghj7mn0wvhxcmmv9uq3samnwvaz7tmjv4kxz7fwv4j82en9v4jzummjvuhsz9thwden5te0wfjkccte9ejxzmt4wvhxjme0qqyxxvmrwaj857rr0rll6z';
    expect(match(long)).toBe(true);
  });

  test('rejects non-naddr strings', () => {
    expect(match('npub1abc')).toBe(false);
    expect(match('hello')).toBe(false);
    expect(match('')).toBe(false);
  });

  test('rejects naddr with invalid bech32 characters', () => {
    expect(match('naddr1ABCDEF' + 'q'.repeat(80))).toBe(false);
  });
});
