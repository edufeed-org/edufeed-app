/**
 * BadgeThumb fallback tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BadgeThumb from '../badges/BadgeThumb.svelte';

describe('BadgeThumb', () => {
  it('renders the image when a src is set', () => {
    const { container } = render(BadgeThumb, {
      props: { thumb: 'https://img.example/badge.png', class: 'h-8 w-8' }
    });
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('shows the gradient placeholder when the image fails to load', async () => {
    const { container } = render(BadgeThumb, {
      props: { thumb: 'https://img.example/badge.png', class: 'h-8 w-8' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[class*="bg-gradient"]')).toBeTruthy();
  });

  it('shows the gradient placeholder when no image is set', () => {
    const { container } = render(BadgeThumb, { props: {} });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[class*="bg-gradient"]')).toBeTruthy();
  });
});
