/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

import LicenseBadge from '$lib/components/shared/LicenseBadge.svelte';

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
function makeEvent(extraTags = []) {
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

describe('LicenseBadge', () => {
  it('renders the formatted license label and credit', () => {
    const { getByText } = render(LicenseBadge, { licenseEvent: makeEvent() });
    expect(getByText(/CC BY 4\.0/)).toBeTruthy();
    expect(getByText(/Jane Doe/)).toBeTruthy();
  });

  it('renders nothing when licenseEvent is null', () => {
    const { container } = render(LicenseBadge, { licenseEvent: null });
    expect(container.textContent?.trim()).toBe('');
  });

  it('exposes the source url in the hover info card when present', async () => {
    vi.useFakeTimers();
    try {
      const { container, getByTestId } = render(LicenseBadge, {
        licenseEvent: makeEvent([['source', 'https://example.com/origin']])
      });
      expect(container.querySelector('[title]')).toBeNull();
      const trigger = /** @type {HTMLElement} */ (container.querySelector('[aria-haspopup]'));
      await fireEvent.mouseEnter(trigger);
      await vi.advanceTimersByTimeAsync(200);
      expect(getByTestId('license-info-source').getAttribute('href')).toBe(
        'https://example.com/origin'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
