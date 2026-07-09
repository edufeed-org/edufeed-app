// @ts-nocheck
/**
 * HeroImage tests (edufeed-app#29)
 *
 * Detail-page hero images must never crop the picture: the full image
 * renders at its natural ratio (object-contain, bounded height) over a
 * blurred backdrop of itself. The image links to the original only for
 * http(s) sources (untrusted event data).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import HeroImage from '../shared/HeroImage.svelte';

const SRC = 'https://example.com/pic.jpg';

describe('<HeroImage>', () => {
  it('renders a contain-fit foreground and a decorative blurred backdrop', () => {
    const { container } = render(HeroImage, { props: { src: SRC, alt: 'Test' } });

    const fg = container.querySelector('img[alt="Test"]');
    expect(fg).toBeTruthy();
    expect(fg.className).toContain('object-contain');

    const backdrop = container.querySelector('[data-testid="hero-image-backdrop"]');
    expect(backdrop).toBeTruthy();
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.className).toContain('blur');
  });

  it('links to the original for http(s) sources', () => {
    const { container } = render(HeroImage, { props: { src: SRC, alt: 'Test' } });
    const link = container.querySelector('a');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(SRC);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders no link for unsafe schemes', () => {
    const { container } = render(HeroImage, {
      props: { src: 'javascript:alert(1)', alt: 'evil' }
    });
    expect(container.querySelector('a')).toBeFalsy();
    expect(container.querySelector('img[alt="evil"]')).toBeTruthy();
  });

  it('can disable the link', () => {
    const { container } = render(HeroImage, {
      props: { src: SRC, alt: 'Test', linkToOriginal: false }
    });
    expect(container.querySelector('a')).toBeFalsy();
  });
});
