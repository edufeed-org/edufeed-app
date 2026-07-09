// @ts-nocheck
/**
 * Calendar event route load tests
 *
 * The /calendar/event/[naddr] route is a common cold-load entry point
 * (shared links, browser address bar). Its load() must initialize the
 * runtime config before fetching, otherwise getAllLookupRelays() is empty
 * and hint-less naddrs can never resolve (edufeed-app#3).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/helpers/nostrUtils', () => ({
  fetchEventById: vi.fn(async () => null)
}));
vi.mock('$lib/helpers/eventUtils', () => ({
  getCalendarEventMetadata: vi.fn((e) => e)
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  initializeConfig: vi.fn()
}));

import { fetchEventById } from '$lib/helpers/nostrUtils';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { load } from '../../routes/calendar/event/[naddr]/+page.js';

describe('/calendar/event/[naddr] load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes runtime config from parent data before fetching the event', async () => {
    const config = { appRelays: { calendar: ['wss://calendar-relay.edufeed.org'] } };
    const parent = vi.fn(async () => ({ config }));

    await load({ params: { naddr: 'naddr1test' }, parent });

    expect(initializeConfig).toHaveBeenCalledWith(config);
    expect(fetchEventById).toHaveBeenCalledWith('naddr1test');
    expect(initializeConfig.mock.invocationCallOrder[0]).toBeLessThan(
      fetchEventById.mock.invocationCallOrder[0]
    );
  });

  it('still fetches when parent provides no config', async () => {
    const parent = vi.fn(async () => ({}));

    await load({ params: { naddr: 'naddr1test' }, parent });

    expect(initializeConfig).not.toHaveBeenCalled();
    expect(fetchEventById).toHaveBeenCalledWith('naddr1test');
  });
});
