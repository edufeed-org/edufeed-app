/**
 * ImageWithFallback Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ImageWithFallback from '../shared/ImageWithFallback.svelte';

const SRC = 'https://img.example/pic.jpg';

describe('ImageWithFallback', () => {
  it('renders the original src when no size preset is given', () => {
    const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic' } });
    expect(container.querySelector('img')?.src).toBe(SRC);
  });

  it('starts at the proxied URL when a size preset is given', () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', size: 'avatar_md' }
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/api/image?');
  });

  it('generic: falls back to the local placeholder after the original fails (no robohash)', async () => {
    const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic' } });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector('[data-testid="image-fallback-placeholder"]');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.getAttribute('aria-label')).toBe('pic');
  });

  it('avatar: tries robohash before the local placeholder', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallbackType: 'avatar' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')?.src).toContain('robohash.org');
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('avatar with robohash={false} skips robohash', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallbackType: 'avatar', robohash: false }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('walks proxy → original → placeholder with a size preset (generic)', async () => {
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', size: 'card' }
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/api/image?');
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')?.src).toBe(SRC);
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('renders the fallback snippet instead of the default placeholder', async () => {
    const fallback = createRawSnippet(() => ({
      render: () => '<span data-testid="custom-fallback">CF</span>'
    }));
    const { container } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic', fallback }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('[data-testid="custom-fallback"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeNull();
  });

  it('shows the placeholder immediately when src is empty', () => {
    const { container } = render(ImageWithFallback, { props: { src: '', alt: 'pic' } });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="image-fallback-placeholder"]')).toBeTruthy();
  });

  it('recovers from the placeholder when src changes', async () => {
    const { container, rerender } = render(ImageWithFallback, {
      props: { src: SRC, alt: 'pic' }
    });
    await fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    await rerender({ src: 'https://img.example/other.jpg' });
    expect(container.querySelector('img')?.src).toBe('https://img.example/other.jpg');
  });

  describe('loading skeleton', () => {
    /** @param {Element} container */
    const getImg = (container) => /** @type {HTMLImageElement} */ (container.querySelector('img'));

    it('shows the skeleton tone until the image loads, then drops it', async () => {
      const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic' } });
      expect(getImg(container).className).toContain('bg-base-200');
      await fireEvent.load(getImg(container));
      expect(getImg(container).className).not.toContain('bg-base-200');
    });

    it('forwards onload to the caller', async () => {
      const onload = vi.fn();
      const { container } = render(ImageWithFallback, { props: { src: SRC, alt: 'pic', onload } });
      await fireEvent.load(getImg(container));
      expect(onload).toHaveBeenCalledTimes(1);
    });

    it('re-applies the skeleton tone when src changes', async () => {
      const { container, rerender } = render(ImageWithFallback, {
        props: { src: SRC, alt: 'pic' }
      });
      await fireEvent.load(getImg(container));
      expect(getImg(container).className).not.toContain('bg-base-200');
      await rerender({ src: 'https://img.example/other.jpg' });
      expect(getImg(container).className).toContain('bg-base-200');
    });
  });
});
