/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Mock modules that trigger browser-only code via nostrUtils import chain
vi.mock('$lib/helpers/relay-helper.js', () => ({ getAllLookupRelays: () => [] }));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({ eventStore: {} }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/loaders', () => ({ eventLoader: vi.fn(), addressLoader: vi.fn() }));

const { generateKindColor, generateKindColorRGB } = await import('../helpers/nostrUtils.js');

describe('generateKindColor', () => {
  it('returns a valid rgb() string', () => {
    expect(generateKindColor(30142)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('is deterministic', () => {
    expect(generateKindColor(30023)).toBe(generateKindColor(30023));
  });

  it('produces distinct colors for all feed content kinds', () => {
    const colors = new Set([
      generateKindColor(11),
      generateKindColor(30023),
      generateKindColor(30142),
      generateKindColor(30301),
      generateKindColor(30818),
      generateKindColor(31922)
    ]);
    expect(colors.size).toBe(6);
  });

  it('returns RGB components in 0-255 range', () => {
    const { r, g, b } = generateKindColorRGB(30142);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });

  it('returns gray fallback for invalid input', () => {
    // @ts-ignore — intentionally passing invalid type to test fallback
    expect(generateKindColorRGB(undefined)).toEqual({ r: 128, g: 128, b: 128 });
  });
});
