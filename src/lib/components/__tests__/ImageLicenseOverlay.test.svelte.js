/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

import ImageLicenseOverlay from '$lib/components/shared/ImageLicenseOverlay.svelte';
import ImageLicenseOverlayInCardWrapper from './ImageLicenseOverlayInCardWrapper.svelte';

// jsdom lacks Element.animate (used by Svelte transitions in HoverCard).
if (!Element.prototype.animate) {
  // @ts-ignore
  Element.prototype.animate = () => {
    const anim = {
      onfinish: /** @type {(() => void) | null} */ (null),
      cancel() {},
      finished: Promise.resolve(),
      currentTime: null,
      playState: 'finished'
    };
    Promise.resolve().then(() => anim.onfinish?.());
    return anim;
  };
}

/** @param {string[][]} [extraTags] */
function licenseEvent(extraTags = []) {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: 1063,
    created_at: 1000,
    content: '',
    tags: [
      ['url', 'https://blossom.example/aaa.jpg'],
      ['x', 'a'.repeat(64)],
      ['m', 'image/jpeg'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane Doe'],
      ...extraTags
    ],
    sig: 'c'.repeat(128)
  };
}

describe('ImageLicenseOverlay', () => {
  it('renders nothing while loading', () => {
    const { container } = render(ImageLicenseOverlay, { status: 'loading' });
    expect(container.textContent?.trim()).toBe('');
  });

  it('renders the known-license badge when found', () => {
    const { getByTestId, getByText } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent()
    });
    expect(getByTestId('license-badge')).toBeTruthy();
    expect(getByText(/CC BY 4\.0/)).toBeTruthy();
    expect(getByText(/Jane Doe/)).toBeTruthy();
  });

  it('renders a readable label for the Unsplash license (not the raw URL)', () => {
    const ev = licenseEvent();
    ev.tags = ev.tags.map((t) =>
      t[0] === 'license' ? ['license', 'https://unsplash.com/license'] : t
    );
    const { getByTestId, getByText, queryByText } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: ev
    });
    expect(getByTestId('license-badge')).toBeTruthy();
    expect(getByText('Unsplash License')).toBeTruthy();
    expect(queryByText('https://unsplash.com/license')).toBeNull();
  });

  it('renders the caution pill with text when missing (variant=pill)', () => {
    const { getByTestId } = render(ImageLicenseOverlay, { status: 'missing', variant: 'pill' });
    const caution = getByTestId('license-caution');
    expect(caution).toBeTruthy();
    expect(caution.textContent).toContain('No license info');
  });

  it('renders icon-only dot (no pill text) when missing (variant=dot)', () => {
    const { getByTestId } = render(ImageLicenseOverlay, { status: 'missing', variant: 'dot' });
    const caution = getByTestId('license-caution');
    expect(caution.textContent).not.toContain('No license info');
  });

  it('opens the popover on focus and closes on Escape', async () => {
    const { getByTestId, queryByTestId } = render(ImageLicenseOverlay, {
      status: 'missing',
      variant: 'pill'
    });
    const caution = getByTestId('license-caution');
    expect(queryByTestId('license-caution-popover')).toBeNull();
    await fireEvent.focus(caution);
    expect(getByTestId('license-caution-popover')).toBeTruthy();
    await fireEvent.keyDown(caution, { key: 'Escape' });
    expect(queryByTestId('license-caution-popover')).toBeNull();
  });
});

describe('ImageLicenseOverlay — AI content label', () => {
  it('shows no AI marker for a plain license', () => {
    const { queryByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent()
    });
    expect(queryByTestId('ai-label')).toBeNull();
  });

  it('marks AI-generated images inside the license badge', () => {
    const { getByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent([['ai', 'generated']])
    });
    const marker = getByTestId('ai-label');
    expect(marker.textContent).toContain('AI generated');
    expect(getByTestId('license-badge').textContent).toContain('CC BY 4.0');
  });

  it('marks AI-modified images', () => {
    const { getByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent([['ai', 'modified']])
    });
    expect(getByTestId('ai-label').textContent).toContain('AI modified');
  });

  it('ignores unknown ai tag values (untrusted input)', () => {
    const { queryByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent([['ai', 'robot']])
    });
    expect(queryByTestId('ai-label')).toBeNull();
  });

  it('still renders the AI marker when the attestation carries no license URL', () => {
    const ev = licenseEvent([['ai', 'generated']]);
    ev.tags = ev.tags.filter((t) => t[0] !== 'license');
    const { getByTestId } = render(ImageLicenseOverlay, { status: 'found', licenseEvent: ev });
    expect(getByTestId('ai-label')).toBeTruthy();
  });
});

describe('ImageLicenseOverlay — license info popover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not rely on a native title tooltip with raw pubkeys', () => {
    const { getByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent([['p', '1'.repeat(64)]])
    });
    expect(getByTestId('license-badge').getAttribute('title')).toBeNull();
  });

  it('opens a readable info card on hover, without raw hex pubkeys', async () => {
    const { container, queryByTestId, getByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent([
        ['p', '1'.repeat(64)],
        ['title', 'Berlin skyline'],
        ['source', 'https://example.org/photos/1']
      ])
    });
    expect(queryByTestId('license-info-card')).toBeNull();
    const trigger = /** @type {HTMLElement} */ (container.querySelector('[aria-haspopup]'));
    await fireEvent.mouseEnter(trigger);
    await vi.advanceTimersByTimeAsync(200);
    const card = getByTestId('license-info-card');
    expect(card.textContent).toContain('Jane Doe');
    expect(card.textContent).toContain('Berlin skyline');
    expect(card.textContent).not.toMatch(/[0-9a-f]{64}/);
    expect(getByTestId('license-info-creator').textContent).toMatch(/^npub1/);
  });

  it('keeps badge clicks and Enter from bubbling to a clickable parent card', async () => {
    const onCardClick = vi.fn();
    const onCardKeydown = vi.fn();
    const { container, getByTestId } = render(ImageLicenseOverlayInCardWrapper, {
      licenseEvent: licenseEvent(),
      onCardClick,
      onCardKeydown
    });
    const trigger = /** @type {HTMLElement} */ (container.querySelector('[aria-haspopup]'));
    await fireEvent.click(trigger);
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardKeydown).not.toHaveBeenCalled();
    // Sanity: the card handlers do fire for clicks outside the badge.
    await fireEvent.click(getByTestId('card'));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it('opens the info card with the keyboard (Enter on the focused badge)', async () => {
    const { container, getByTestId } = render(ImageLicenseOverlay, {
      status: 'found',
      licenseEvent: licenseEvent()
    });
    const trigger = /** @type {HTMLElement} */ (container.querySelector('[aria-haspopup]'));
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(0);
    expect(getByTestId('license-info-card')).toBeTruthy();
  });
});
