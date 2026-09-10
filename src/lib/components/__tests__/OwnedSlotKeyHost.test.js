/** @vitest-environment jsdom */
/**
 * Regression for "content types and channels missing when switching
 * accounts on a community": the root layout keys the route tree on the
 * session epoch, and Svelte 5's key block creates the NEW branch before it
 * destroys the OLD one. A child that registers chrome data through context
 * and unregisters with a bare `set(undefined)` on destroy therefore wipes
 * its successor's registration. The owned-slot contract must survive that.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import OwnedSlotKeyHost from './fixtures/OwnedSlotKeyHost.svelte';

describe('owned slot under a {#key} remount', () => {
  it('renders the child registration initially', async () => {
    render(OwnedSlotKeyHost, { epoch: 0 });
    await tick();
    expect(screen.getByTestId('chrome').textContent).toBe('child-0');
  });

  it('keeps the new registration after the key block remounts the child', async () => {
    const { rerender } = render(OwnedSlotKeyHost, { epoch: 0 });
    await tick();
    await rerender({ epoch: 1 });
    await tick();
    expect(screen.getByTestId('child').textContent).toBe('child-1');
    expect(screen.getByTestId('chrome').textContent).toBe('child-1');
  });

  it('clears the slot when the child is unmounted for good', async () => {
    const { unmount } = render(OwnedSlotKeyHost, { epoch: 0 });
    await tick();
    unmount();
    // Nothing to assert in the DOM after unmount; the unit test covers
    // release(). This just proves teardown does not throw.
  });
});
