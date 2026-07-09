// @ts-nocheck
/**
 * Event-bar text contrast tests (follow-up to edufeed-app#29 testing)
 *
 * Author colors span the full hue circle, and dark blues/purples with the
 * hardcoded black label were unreadable. Text color must follow the
 * background's luminance.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// nostrUtils pulls window-dependent infrastructure at module scope
vi.mock('$lib/loaders', () => ({ addressLoader: () => {}, eventLoader: () => {} }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getAppManagedRelays: () => []
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({ eventStore: {} }));

import { readableTextColor, generateAuthorColor } from '$lib/helpers/nostrUtils.js';

describe('readableTextColor', () => {
  it('uses black text on light backgrounds', () => {
    expect(readableTextColor('rgb(255,255,255)')).toBe('#000000');
    expect(readableTextColor('rgb(122,213,213)')).toBe('#000000'); // teal bars
    expect(readableTextColor('#ffd97a')).toBe('#000000');
  });

  it('uses white text on dark backgrounds', () => {
    expect(readableTextColor('rgb(0,0,0)')).toBe('#ffffff');
    expect(readableTextColor('rgb(73,73,245)')).toBe('#ffffff'); // dark blue bars
    expect(readableTextColor('#4b0082')).toBe('#ffffff');
  });

  it('falls back to black for unparseable values', () => {
    expect(readableTextColor('')).toBe('#000000');
    expect(readableTextColor('oklch(0.5 0.1 200)')).toBe('#000000');
    expect(readableTextColor(null)).toBe('#000000');
  });

  it('every generated author color yields at least 4.5:1 contrast with its text', () => {
    const lum = (r, g, b) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    for (let i = 0; i < 360; i += 7) {
      const pubkey = (BigInt(i) + 360n * 100n).toString(16).padStart(64, '0');
      const bg = generateAuthorColor(pubkey);
      const [r, g, b] = bg.match(/\d+/g).map(Number);
      const text = readableTextColor(bg);
      const bgL = lum(r, g, b);
      const textL = text === '#000000' ? 0 : 1;
      const contrast = (Math.max(bgL, textL) + 0.05) / (Math.min(bgL, textL) + 0.05);
      expect(contrast, `bg ${bg} with ${text}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
