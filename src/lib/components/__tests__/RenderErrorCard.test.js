/**
 * RenderErrorCard — fallback UI for the route-level <svelte:boundary>.
 *
 * A render error in one page (e.g. each_key_duplicate from a malformed
 * event) must degrade to this card instead of killing the whole app shell.
 * The card retries via the boundary's reset, and auto-resets when the user
 * navigates away so the next page renders normally.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const { navigateCallbacks } = vi.hoisted(() => ({
  navigateCallbacks: /** @type {Array<() => void>} */ ([])
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: (/** @type {() => void} */ cb) => navigateCallbacks.push(cb)
}));

import RenderErrorCard from '../shared/RenderErrorCard.svelte';

describe('RenderErrorCard', () => {
  beforeEach(() => {
    navigateCallbacks.length = 0;
  });

  it('renders a retry button that calls onretry', async () => {
    const onretry = vi.fn();
    const { container } = render(RenderErrorCard, {
      props: { error: new Error('boom'), onretry }
    });

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {Element} */ (button));
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('shows the error message as detail', () => {
    const { container } = render(RenderErrorCard, {
      props: { error: new Error('each_key_duplicate'), onretry: () => {} }
    });
    expect(container.textContent).toContain('each_key_duplicate');
  });

  it('auto-resets on navigation so the next page is not stuck on the error', () => {
    const onretry = vi.fn();
    render(RenderErrorCard, { props: { error: new Error('boom'), onretry } });

    expect(navigateCallbacks.length).toBe(1);
    navigateCallbacks[0]();
    expect(onretry).toHaveBeenCalledTimes(1);
  });
});
