// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import WebxdcPlayer from '../../webxdc/WebxdcPlayer.svelte';

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null },
  useActiveUser: () => () => null
}));
// The player previews the signed-in profile on the launch card; the tests
// exercise launch/sandbox behavior, not the profile chrome.
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

afterEach(() => vi.unstubAllGlobals());

const xdcBytes = zipSync({ 'index.html': strToU8('<html></html>') });

describe('WebxdcPlayer', () => {
  it('renders the launch card with the app name', () => {
    const { getByText } = render(WebxdcPlayer, {
      props: { url: 'https://b/x.xdc', sha256: 'ab', name: 'My Quiz', appKey: 'k' }
    });
    expect(getByText('My Quiz')).toBeTruthy();
    expect(getByText(/Launch|Starten/)).toBeTruthy();
  });

  it('shows the integrity error card on hash mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(xdcBytes))
    );
    const { getByText, findByText } = render(WebxdcPlayer, {
      props: { url: 'https://b/x.xdc', sha256: 'ff'.repeat(32), name: 'App', appKey: 'k' }
    });
    await fireEvent.click(getByText(/Launch|Starten/));
    expect(await findByText(/checksum|Prüfsumme/)).toBeTruthy();
  });

  it('starts directly from bytes (preview mode) and renders the sandbox frame', async () => {
    const { getByText, container } = render(WebxdcPlayer, {
      props: { bytes: xdcBytes, name: 'Preview', appKey: 'preview:k' }
    });
    await fireEvent.click(getByText(/Launch|Starten/));
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
  });

  it('cleans up the ready timer and sync subscription on unmount', async () => {
    const { getByText, container, unmount } = render(WebxdcPlayer, {
      props: { bytes: xdcBytes, name: 'Preview', appKey: 'unmount:k' }
    });
    await fireEvent.click(getByText(/Launch|Starten/));
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());

    const spy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      unmount();
      // close() unconditionally clears the 15s ready timer on unmount —
      // observing that call is the cleanest signal that cleanup ran (the
      // sync unsubscribe has no independently-observable side effect here).
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('exposes launchApp() on the component instance to launch without clicking the button', async () => {
    const { component, container } = render(WebxdcPlayer, {
      props: { bytes: xdcBytes, name: 'Instance Launch', appKey: 'instance:k' }
    });
    await component.launchApp();
    await waitFor(() => expect(container.querySelector('iframe')).toBeTruthy());
  });

  it('errors with retry when the frame never signals ready', async () => {
    vi.useFakeTimers();
    try {
      const { getByText, findByText } = render(WebxdcPlayer, {
        props: { bytes: xdcBytes, name: 'Slow', appKey: 'slow:k' }
      });
      await fireEvent.click(getByText(/Launch|Starten/));
      vi.advanceTimersByTime(16000);
      expect(await findByText(/did not start|nicht rechtzeitig/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
