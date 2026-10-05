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

  // A `display: contents` wrapper (CallChatPanel's sender link) has no box:
  // its getBoundingClientRect() is all zeros, which pinned the fixed popup
  // to the viewport's top-left corner (laoc QA 2026-10-05). The position
  // must come from the trigger's rendered element instead.
  it('fixed popup anchors to the trigger when the wrapper is display: contents', async () => {
    const { container } = render(HoverCardTestWrapper, {
      props: { fixed: true, position: 'top', class: 'contents', triggerClass: 'contents' }
    });
    const trigger = container.querySelector('[data-testid="trigger"]');
    trigger.getBoundingClientRect = () => ({
      left: 600,
      top: 500,
      right: 680,
      bottom: 520,
      width: 80,
      height: 20,
      x: 600,
      y: 500
    });

    await fireEvent.mouseEnter(container.querySelector('[data-testid="hover-card-wrapper"]'));
    vi.advanceTimersByTime(200);
    await tick();

    const card = document.querySelector('[role="tooltip"]');
    expect(card.style.left).toBe('600px');
    expect(card.style.bottom).toBe(`${window.innerHeight - 500 + 8}px`);
  });

  // interactiveTrigger: the trigger is its own interactive element (an <a>
  // here) — the wrapper must not add a second, nested one, and keyboard
  // focus (not just hover/click) must open the card (laoc QA 2026-10-02).
  describe('interactiveTrigger', () => {
    it('adds no nested interactive wrapper — one tab stop', () => {
      const { container, getByTestId } = render(HoverCardTestWrapper, {
        props: { interactiveTrigger: true }
      });
      const wrapper = getByTestId('hover-card-wrapper');
      expect(wrapper.getAttribute('role')).toBeNull();
      expect(wrapper.getAttribute('tabindex')).toBeNull();
      expect(wrapper.getAttribute('aria-haspopup')).toBeNull();
      // Only the inner <a> is tabbable.
      expect(container.querySelectorAll('[tabindex], a, button')).toHaveLength(1);
      expect(getByTestId('trigger').tagName).toBe('A');
    });

    it('opens on focus, no delay', async () => {
      const { getByTestId, queryByTestId } = render(HoverCardTestWrapper, {
        props: { interactiveTrigger: true, enterDelay: 999 }
      });
      const link = getByTestId('trigger');
      expect(queryByTestId('content')).toBeNull();

      await fireEvent.focusIn(link);
      await tick();
      expect(queryByTestId('content')).not.toBeNull();
    });

    it('closes on focus leaving the trigger, stays open moving into the popup', async () => {
      const { getByTestId, queryByTestId, container } = render(HoverCardTestWrapper, {
        props: { interactiveTrigger: true, fixed: true }
      });
      const link = getByTestId('trigger');
      await fireEvent.focusIn(link);
      await tick();
      expect(queryByTestId('content')).not.toBeNull();

      // Focus moving to the popup's own button must not close it.
      const popupButton = document.querySelector('[data-testid="content-button"]');
      await fireEvent.focusOut(link, { relatedTarget: popupButton });
      await tick();
      expect(queryByTestId('content')).not.toBeNull();

      // Focus leaving entirely closes it.
      await fireEvent.focusOut(popupButton, { relatedTarget: document.body });
      await tick();
      expect(queryByTestId('content')).toBeNull();
      void container;
    });

    it('a click on the trigger does not toggle the card itself (only the link navigates)', async () => {
      const { getByTestId, queryByTestId } = render(HoverCardTestWrapper, {
        props: { interactiveTrigger: true }
      });
      const link = getByTestId('trigger');
      await fireEvent.click(link);
      await tick();
      // No click-to-toggle wiring in this mode: a bare click (no focus event
      // fired by jsdom's fireEvent.click) leaves the card closed.
      expect(queryByTestId('content')).toBeNull();
    });
  });
});
