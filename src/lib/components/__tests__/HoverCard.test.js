/**
 * HoverCard Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import HoverCardTestWrapper from './HoverCardTestWrapper.svelte';

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
    await tick();
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
});
