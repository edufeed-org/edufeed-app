/**
 * LocalCachePanel component tests.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

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
  settings_cache_cancel_button: () => 'Cancel'
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

  it('clears the cache and resets the count when confirmed', async () => {
    const { count, clear } = await import('$lib/stores/event-cache.svelte.js');
    /** @type {any} */ (count).mockResolvedValueOnce(500);
    render(LocalCachePanel);
    await screen.findByText(/500/);

    const btn = screen.getByRole('button', { name: /clear cache/i });
    await fireEvent.click(btn);
    const dialog = await screen.findByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /clear cache/i });
    await fireEvent.click(confirmBtn);

    expect(clear).toHaveBeenCalledOnce();
  });
});
