/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import TypoCover from '$lib/components/educational/TypoCover.svelte';

describe('TypoCover hueOverride', () => {
  it('uses hueOverride when provided', () => {
    const { getByTestId } = render(TypoCover, {
      props: {
        title: 'Test',
        contentTypeLabel: null,
        metaLabel: null,
        paletteId: 'abc',
        hueOverride: 200
      }
    });
    const style = getByTestId('typo-cover-frame').getAttribute('style') || '';
    expect(style).toContain('--cover-hue: 200');
    expect(style).toContain('oklch(55% 0.10 200)');
  });

  it('honors hueOverride 0 (does not fall back to the hash)', () => {
    const { getByTestId } = render(TypoCover, {
      props: {
        title: 'Test',
        contentTypeLabel: null,
        metaLabel: null,
        paletteId: 'abc',
        hueOverride: 0
      }
    });
    const style = getByTestId('typo-cover-frame').getAttribute('style') || '';
    expect(style).toContain('--cover-hue: 0');
  });

  it('falls back to the hashed hue when hueOverride is null', () => {
    const { getByTestId } = render(TypoCover, {
      props: {
        title: 'Test',
        contentTypeLabel: null,
        metaLabel: null,
        paletteId: 'abc',
        hueOverride: null
      }
    });
    const style = getByTestId('typo-cover-frame').getAttribute('style') || '';
    // 'abc' → stringColorHue is non-null; assert a hue var is present and not the neutral grey marker.
    expect(style).toContain('--cover-hue:');
    expect(style).not.toContain('oklch(45% 0.01 250)');
  });
});
