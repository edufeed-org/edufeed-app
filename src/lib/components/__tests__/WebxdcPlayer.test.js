// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { zipSync, strToU8 } from 'fflate';
import WebxdcPlayer from '../../webxdc/WebxdcPlayer.svelte';

vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));

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
