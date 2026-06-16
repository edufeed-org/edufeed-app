// @ts-nocheck
/**
 * HoverCard Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import HoverCardTestWrapper from './HoverCardTestWrapper.svelte';

// Polyfill Element.animate for jsdom (used by Svelte transitions).
// Returns an animation that completes instantly so transitions don't block DOM removal.
if (!Element.prototype.animate) {
  Element.prototype.animate = function (_keyframes, _options) {
    const finishedPromise = Promise.resolve();
    const anim = {
      onfinish: /** @type {(() => void) | null} */ (null),
      cancel: vi.fn(),
      finished: finishedPromise,
      // Svelte checks currentTime to see if animation is done
      currentTime: /** @type {number | null} */ (null),
      playState: 'finished'
    };
    // Use a promise microtask chain so onfinish fires after Svelte sets it
    finishedPromise.then(() => {
      if (anim.onfinish) anim.onfinish();
    });
    return anim;
  };
}

describe('HoverCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders trigger content', () => {
    const { getByTestId } = render(HoverCardTestWrapper);
    expect(getByTestId('trigger')).toBeTruthy();
  });

  it('content is hidden by default', () => {
    const { queryByTestId } = render(HoverCardTestWrapper);
    expect(queryByTestId('content')).toBeNull();
  });

  it('shows content after mouseenter and delay', async () => {
    const { container, queryByTestId } = render(HoverCardTestWrapper, {
      props: { enterDelay: 100 }
    });
    const wrapper = container.querySelector('[aria-haspopup]');

    await fireEvent.mouseEnter(wrapper);
    expect(queryByTestId('content')).toBeNull();

    vi.advanceTimersByTime(100);
    await tick();

    expect(queryByTestId('content')).not.toBeNull();
  });

  it('hides content after mouseleave and delay', async () => {
    const { container, queryByTestId } = render(HoverCardTestWrapper, {
      props: { enterDelay: 0, leaveDelay: 200 }
    });
    const wrapper = container.querySelector('[aria-haspopup]');

    // Open
    await fireEvent.mouseEnter(wrapper);
    vi.advanceTimersByTime(0);
    await tick();
    expect(queryByTestId('content')).not.toBeNull();

    // Leave
    await fireEvent.mouseLeave(wrapper);
    expect(queryByTestId('content')).not.toBeNull();

    vi.advanceTimersByTime(200);
    // Flush Svelte reactivity + transition animation microtasks
    for (let i = 0; i < 5; i++) await tick();
    expect(queryByTestId('content')).toBeNull();
  });

  it('click toggles visibility', async () => {
    const { container, queryByTestId } = render(HoverCardTestWrapper);
    const wrapper = container.querySelector('[aria-haspopup]');

    await fireEvent.click(wrapper);
    await tick();
    expect(queryByTestId('content')).not.toBeNull();

    await fireEvent.click(wrapper);
    await tick();
    expect(queryByTestId('content')).toBeNull();
  });

  it('Escape key dismisses', async () => {
    const { container, queryByTestId } = render(HoverCardTestWrapper);
    const wrapper = container.querySelector('[aria-haspopup]');

    await fireEvent.click(wrapper);
    await tick();
    expect(queryByTestId('content')).not.toBeNull();

    await fireEvent.keyDown(wrapper, { key: 'Escape' });
    await tick();
    expect(queryByTestId('content')).toBeNull();
  });

  it('sets aria-expanded correctly', async () => {
    const { container } = render(HoverCardTestWrapper);
    const wrapper = container.querySelector('[aria-haspopup]');

    expect(wrapper.getAttribute('aria-expanded')).toBe('false');

    await fireEvent.click(wrapper);
    await tick();
    expect(wrapper.getAttribute('aria-expanded')).toBe('true');
  });

  it('positions card above when position is top', async () => {
    const { container } = render(HoverCardTestWrapper, {
      props: { position: 'top' }
    });
    const wrapper = container.querySelector('[aria-haspopup]');

    await fireEvent.click(wrapper);
    await tick();

    const card = container.querySelector('[role="tooltip"]');
    expect(card.className).toContain('bottom-full');
  });

  it('positions card below when position is bottom', async () => {
    const { container } = render(HoverCardTestWrapper, {
      props: { position: 'bottom' }
    });
    const wrapper = container.querySelector('[aria-haspopup]');

    await fireEvent.click(wrapper);
    await tick();

    const card = container.querySelector('[role="tooltip"]');
    expect(card.className).toContain('top-full');
  });

  // Regression guard: when fixed=true the popup is portaled out of its normal
  // DOM position. It MUST stay inside Svelte's event-delegation root (the mount
  // container) so delegated onclick handlers on its content still fire. A naive
  // document.body.appendChild moves it outside that root and silently kills all
  // clicks inside portaled hover cards (e.g. the profile wave button, which then
  // lets its wrapping <a href> navigate away). See HoverCard.svelte portal().
  it('fires click handlers on portaled (fixed) content', async () => {
    const onAction = vi.fn();
    const { container } = render(HoverCardTestWrapper, {
      props: { fixed: true, onAction }
    });
    const wrapper = container.querySelector('[aria-haspopup]');

    // Open via click (handleClick toggles immediately, no timer needed)
    await fireEvent.click(wrapper);
    await tick();

    // Content is portaled out of `container`, so query the whole document.
    const button = document.querySelector('[data-testid="content-button"]');
    expect(button).not.toBeNull();

    // The portaled node must remain within the mount container (delegation root),
    // not be reparented directly under <body>.
    expect(container.contains(button)).toBe(true);

    await fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
