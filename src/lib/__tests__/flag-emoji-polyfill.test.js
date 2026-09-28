// @ts-nocheck
/** @vitest-environment node */
/**
 * flag-emoji-polyfill.js — Windows flag fallback. The font must come from our
 * own origin (self-hosted fonts rule), never the package's jsDelivr default,
 * and every app font stack must list the flag family first or the injected
 * font face is never used.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import layoutSource from '../../routes/+layout.svelte?raw';

const polyfill = vi.hoisted(() => ({ polyfillCountryFlagEmojis: vi.fn(() => true) }));
vi.mock('country-flag-emoji-polyfill', () => polyfill);

import { FLAG_FONT_FAMILY, installFlagEmojiPolyfill } from '$lib/helpers/flag-emoji-polyfill.js';

describe('installFlagEmojiPolyfill', () => {
  it('injects the flag font under the app family name from a self-hosted woff2', () => {
    expect(installFlagEmojiPolyfill()).toBe(true);
    const [family, url] = polyfill.polyfillCountryFlagEmojis.mock.calls[0];
    expect(family).toBe('Twemoji Country Flags');
    expect(url).toMatch(/TwemojiCountryFlags\.woff2/);
    expect(url).not.toMatch(/^https?:/);
  });
});

describe('app font stacks', () => {
  // ?raw on a .css file comes back empty under vitest's css handling
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
  const stacks = [...css.matchAll(/--font-(sans|display|script|community):\s*([^;]+);/g)];

  it('all start with the flag font family (default, rpi and stil themes)', () => {
    expect(stacks.length).toBeGreaterThanOrEqual(8);
    for (const [, name, value] of stacks) {
      expect(value.trim().startsWith(`'${FLAG_FONT_FAMILY}'`), `--font-${name}: ${value}`).toBe(
        true
      );
    }
  });
});

describe('root layout', () => {
  it('loads the polyfill lazily, not as a static import', () => {
    expect(layoutSource).toMatch(/import\('\$lib\/helpers\/flag-emoji-polyfill\.js'\)/);
    expect(layoutSource).not.toMatch(/^\s*import [^(]*flag-emoji-polyfill/m);
  });
});
