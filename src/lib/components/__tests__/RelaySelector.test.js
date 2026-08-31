/**
 * RelaySelector — the calendar's custom relay field. It compares against
 * runtimeConfig relays with a raw string ===, so the normalized value must stay
 * bare (no trailing slash) or every config relay looks like a new custom one.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'relay_filter_popular',
      'relay_filter_custom',
      'relay_filter_custom_placeholder',
      'relay_filter_custom_relays',
      'relay_filter_add',
      'relay_filter_remove',
      'relay_filter_clear_all',
      'relay_filter_already_exists',
      'relay_url_invalid'
    ].map((k) => [k, () => k])
  )
);

const mockFilters = vi.hoisted(() => ({
  selectedRelays: /** @type {string[]} */ ([]),
  setSelectedRelays: vi.fn()
}));
vi.mock('$lib/stores/calendar-filters.svelte.js', () => ({ calendarFilters: mockFilters }));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    appRelays: { calendar: ['wss://calendar.example.org'] },
    fallbackRelays: []
  }
}));

import RelaySelector from '../calendar/RelaySelector.svelte';

/** @param {HTMLElement} container @param {string} value */
async function addRelay(container, value) {
  const input = /** @type {HTMLInputElement} */ (container.querySelector('input[type="text"]'));
  await fireEvent.input(input, { target: { value } });
  const button = /** @type {HTMLButtonElement} */ (
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('relay_filter_add')
    )
  );
  await fireEvent.click(button);
}

describe('RelaySelector custom relay input', () => {
  beforeEach(() => {
    mockFilters.selectedRelays = [];
    mockFilters.setSelectedRelays.mockClear();
  });

  it('prepends wss:// to a bare hostname', async () => {
    const { container, getByText } = render(RelaySelector);

    await addRelay(container, 'relay.example.org');

    expect(mockFilters.setSelectedRelays).toHaveBeenCalledWith(['wss://relay.example.org']);
    expect(getByText('relay.example.org')).toBeTruthy();
  });

  it('keeps an explicit ws:// so localhost dev relays stay reachable', async () => {
    const { container } = render(RelaySelector);

    await addRelay(container, 'ws://localhost:7777');

    expect(mockFilters.setSelectedRelays).toHaveBeenCalledWith(['ws://localhost:7777']);
  });

  it('matches a config relay typed bare as an existing relay', async () => {
    const { container, getByText } = render(RelaySelector);

    await addRelay(container, 'calendar.example.org');

    expect(mockFilters.setSelectedRelays).not.toHaveBeenCalled();
    expect(getByText('relay_filter_already_exists')).toBeTruthy();
  });

  it('rejects a non-websocket scheme', async () => {
    const { container, getByText } = render(RelaySelector);

    await addRelay(container, 'https://relay.example.org');

    expect(mockFilters.setSelectedRelays).not.toHaveBeenCalled();
    expect(getByText('relay_url_invalid')).toBeTruthy();
  });
});
