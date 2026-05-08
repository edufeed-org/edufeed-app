/**
 * LocalCachePanel component tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

// jsdom does not implement HTMLDialogElement.showModal/close. Polyfill them
// so the dialog-based modal in LocalCachePanel can open/close in tests.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}

vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  count: vi.fn(async () => 1234),
  clear: vi.fn(async () => {})
}));

vi.mock('$lib/paraglide/messages', () => ({
  settings_cache_title: () => 'Local cache',
  settings_cache_description: () => 'ComCal stores recently-loaded profiles…',
  settings_cache_event_count: (/** @type {{ count: number }} */ { count }) =>
    `~${count} events cached`,
  settings_cache_clear_button: () => 'Clear cache',
  settings_cache_cleared_toast: () => 'Local cache cleared.',
  settings_cache_confirm_title: () => 'Clear local cache?',
  settings_cache_confirm_message: () =>
    'Your browser will re-download cached content as you browse.',
  settings_cache_cancel_button: () => 'Cancel',
  settings_cache_confirm_button: () => 'Confirm'
}));

import LocalCachePanel from '$lib/components/settings/LocalCachePanel.svelte';

describe('LocalCachePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the cached event count on mount', async () => {
    render(LocalCachePanel);
    expect(await screen.findByText(/1234|1,234/)).toBeTruthy();
  });

  it('clears the cache and refreshes the count when confirmed', async () => {
    const { count, clear } = await import('$lib/stores/event-cache.svelte.js');
    /** @type {any} */ (count).mockResolvedValueOnce(500); // initial load
    /** @type {any} */ (count).mockResolvedValueOnce(0); // post-clear load
    render(LocalCachePanel);
    await screen.findByText(/500/);

    await fireEvent.click(screen.getByRole('button', { name: /clear cache/i }));
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /confirm/i });
    await fireEvent.click(confirmBtn);

    expect(clear).toHaveBeenCalledOnce();
    expect(count).toHaveBeenCalledTimes(2);
    await screen.findByText(/0 events|0 Ereignisse/);
  });

  it('disables buttons while clearing', async () => {
    const { count, clear } = await import('$lib/stores/event-cache.svelte.js');
    /** @type {any} */ (count).mockResolvedValue(500);
    /** @type {(value?: unknown) => void} */
    let resolveClear = () => {};
    /** @type {any} */ (clear).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveClear = r;
        })
    );

    render(LocalCachePanel);
    await screen.findByText(/500/);
    await fireEvent.click(screen.getByRole('button', { name: /clear cache/i }));

    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /confirm/i });
    await fireEvent.click(confirmBtn);

    const cancelBtn = within(dialog).getByRole('button', { name: /cancel/i });
    expect(/** @type {HTMLButtonElement} */ (confirmBtn).disabled).toBe(true);
    expect(/** @type {HTMLButtonElement} */ (cancelBtn).disabled).toBe(true);

    resolveClear();
  });
});
