/**
 * WebxdcAppPicker — the discovery section ("Weitere Apps") is opt-in per
 * user: by default the picker resolves only the curated WEBXDC_APPS and
 * never fires the relay-wide kind-1063 discovery REQ (laoc, 2026-09-07).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { of } from 'rxjs';

const requestMock = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: (/** @type {any[]} */ ...args) => requestMock(...args) }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://edu.example'],
  getAllLookupRelays: () => ['wss://lookup.example']
}));
const settings = { webxdcShowAllApps: false };
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  get appSettings() {
    return settings;
  }
}));
vi.mock('$lib/paraglide/messages', () => ({
  webxdc_apps_pick_title: () => 'Share an app',
  webxdc_apps_featured: () => 'Recommended',
  webxdc_apps_discovered: () => 'More apps',
  webxdc_apps_none: () => 'No published apps found',
  webxdc_launch: () => 'Launch',
  webxdc_close: () => 'Close'
}));

import WebxdcAppPicker from '$lib/components/groups/WebxdcAppPicker.svelte';

/** @param {string} id @param {string} name */
const fileEvent = (id, name) => ({
  id,
  kind: 1063,
  pubkey: 'a'.repeat(64),
  created_at: 1000,
  sig: 'x',
  content: name,
  tags: [
    ['url', `https://blossom.example/${id}.xdc`],
    ['m', 'application/x-webxdc'],
    ['x', id.padEnd(64, '0')],
    ['alt', `Webxdc app: ${name}`]
  ]
});

const CURATED_ID = 'c'.repeat(64);
const OTHER_ID = 'd'.repeat(64);

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((_relays, filters) => {
    const filter = filters[0];
    if (filter.ids) return of(fileEvent(CURATED_ID, 'Pad'));
    return of(fileEvent(OTHER_ID, 'Some other app'));
  });
});

describe('WebxdcAppPicker', () => {
  it('lists only the curated app and skips the discovery REQ by default', async () => {
    settings.webxdcShowAllApps = false;
    render(WebxdcAppPicker, {
      props: { curatedApps: [CURATED_ID], onSelect: () => {}, onClose: () => {} }
    });
    await waitFor(() => expect(screen.getByTestId('webxdc-app-picker-featured')).toBeTruthy());
    expect(screen.queryByText('More apps')).toBeNull();
    expect(screen.queryByText('Some other app')).toBeNull();
    const discoveryCalls = requestMock.mock.calls.filter(([, filters]) => filters[0].kinds);
    expect(discoveryCalls).toHaveLength(0);
  });

  it('adds the discovered apps once the per-user setting is on', async () => {
    settings.webxdcShowAllApps = true;
    render(WebxdcAppPicker, {
      props: { curatedApps: [CURATED_ID], onSelect: () => {}, onClose: () => {} }
    });
    await waitFor(() => expect(screen.getByText('Some other app')).toBeTruthy());
    expect(screen.getByText('More apps')).toBeTruthy();
    expect(screen.getByTestId('webxdc-app-picker-featured')).toBeTruthy();
  });

  it('says so when nothing is curated and discovery is off', async () => {
    settings.webxdcShowAllApps = false;
    render(WebxdcAppPicker, { props: { curatedApps: [], onSelect: () => {}, onClose: () => {} } });
    await waitFor(() => expect(screen.getByText('No published apps found')).toBeTruthy());
    expect(requestMock).not.toHaveBeenCalled();
  });
});
