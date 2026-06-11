/**
 * TypoCover component tests.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import TypoCover from '../TypoCover.svelte';

/** @param {Partial<import('svelte').ComponentProps<typeof TypoCover>>} [overrides] */
function defaultProps(overrides = {}) {
  return {
    title: 'Morgen bestimme ich',
    contentTypeLabel: 'Stundenentwurf',
    metaLabel: '8–10 Jahre',
    paletteId: 'sample-resource',
    size: /** @type {'full'} */ ('full'),
    ...overrides
  };
}

describe('TypoCover', () => {
  it('renders a 3:4 portrait wrapper at every size', () => {
    for (const size of /** @type {const} */ (['thumbnail', 'full'])) {
      const { container } = render(TypoCover, { props: defaultProps({ size }) });
      const frame = container.querySelector('[data-testid="typo-cover-card"]');
      expect(frame).not.toBeNull();
      // aspect-[3/4] is applied via a tailwind class — assert the class is present.
      expect(frame?.className).toMatch(/aspect-\[3\/4\]/);
    }
  });

  it('size="thumbnail" omits the title stack and footer but keeps the pill', () => {
    const { container } = render(TypoCover, { props: defaultProps({ size: 'thumbnail' }) });
    expect(container.querySelector('[data-testid="typo-cover-pill"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="typo-cover-title-stack"]')).toBeNull();
    expect(container.querySelector('[data-testid="typo-cover-footer"]')).toBeNull();
  });

  it('size="full" renders pill, title stack (with leading/script/trailing), and footer', () => {
    const { container, getByTestId } = render(TypoCover, {
      props: defaultProps({ size: 'full' })
    });
    expect(getByTestId('typo-cover-pill').textContent).toContain('Stundenentwurf');
    expect(getByTestId('typo-cover-title-leading').textContent).toContain('Morgen');
    expect(getByTestId('typo-cover-title-script').textContent).toContain('bestimme');
    expect(getByTestId('typo-cover-title-trailing').textContent).toContain('ich');
    expect(container.querySelector('[data-testid="typo-cover-footer"]')).not.toBeNull();
  });

  it('single-word title renders only the script word; leading/trailing absent', () => {
    const { container, getByTestId } = render(TypoCover, {
      props: defaultProps({ title: 'Reformation' })
    });
    expect(getByTestId('typo-cover-title-script').textContent).toContain('Reformation');
    expect(container.querySelector('[data-testid="typo-cover-title-leading"]')).toBeNull();
    expect(container.querySelector('[data-testid="typo-cover-title-trailing"]')).toBeNull();
  });

  it('empty title still renders the card without crashing', () => {
    const { container } = render(TypoCover, { props: defaultProps({ title: '' }) });
    expect(container.querySelector('[data-testid="typo-cover-card"]')).not.toBeNull();
  });

  it('contentTypeLabel=null omits the pill', () => {
    const { container } = render(TypoCover, {
      props: defaultProps({ contentTypeLabel: null })
    });
    expect(container.querySelector('[data-testid="typo-cover-pill"]')).toBeNull();
  });

  it('metaLabel=null hides the footer-left text but keeps the credit', () => {
    const { container, getByTestId } = render(TypoCover, {
      props: defaultProps({ metaLabel: null })
    });
    expect(container.querySelector('[data-testid="typo-cover-meta"]')).toBeNull();
    expect(getByTestId('typo-cover-credit').textContent).toContain('edufeed');
  });

  it('applies --c-hero / --c-hero-2 inline styles derived from paletteId', () => {
    const { container } = render(TypoCover, { props: defaultProps({ paletteId: 'foo' }) });
    const frame = /** @type {HTMLElement | null} */ (
      container.querySelector('[data-testid="typo-cover-frame"]')
    );
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('style') ?? '').toMatch(/--c-hero:\s*oklch/);
    expect(frame?.getAttribute('style') ?? '').toMatch(/--c-hero-2:\s*oklch/);
  });

  it('empty paletteId falls back to the neutral grey palette', () => {
    const { container } = render(TypoCover, { props: defaultProps({ paletteId: '' }) });
    const frame = /** @type {HTMLElement | null} */ (
      container.querySelector('[data-testid="typo-cover-frame"]')
    );
    // Neutral grey uses hue 250 in our fallback — see TypoCover.svelte.
    expect(frame?.getAttribute('style') ?? '').toMatch(/--c-hero:\s*oklch\(45% 0\.01 250\)/);
  });

  it('long titles render as a plain headline (no script word) at size=full', () => {
    const longTitle =
      '"Anders sein" heißt einmalig sein – und doch als Klasse zusammenzugehören. ' +
      'Eine Unterrichtsidee mit dem Wendebuch';
    const { container, getByTestId } = render(TypoCover, {
      props: defaultProps({ title: longTitle, size: 'full' })
    });
    expect(getByTestId('typo-cover-title-headline').textContent).toContain('Anders sein');
    expect(getByTestId('typo-cover-title-headline').textContent).toContain('Wendebuch');
    // Short-layout slots must not render.
    expect(container.querySelector('[data-testid="typo-cover-title-stack"]')).toBeNull();
    expect(container.querySelector('[data-testid="typo-cover-title-script"]')).toBeNull();
  });

  it('short titles still use the split layout (regression guard)', () => {
    const { container, getByTestId } = render(TypoCover, {
      props: defaultProps({ title: 'Morgen bestimme ich' })
    });
    expect(getByTestId('typo-cover-title-script').textContent).toContain('bestimme');
    expect(container.querySelector('[data-testid="typo-cover-title-headline"]')).toBeNull();
  });
});
