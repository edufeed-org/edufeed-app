/**
 * DashboardFeedSelector Component Tests
 *
 * Verifies the feed source dropdown: base options, the Relays section
 * (NIP-65 + community + custom), relay selection writing appSettings,
 * and the remove affordance on custom relays.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DashboardFeedSelector from '../dashboard/DashboardFeedSelector.svelte';

vi.mock('$lib/paraglide/messages', () => ({
  dashboard_feed_selector_communities: () => 'Communities',
  dashboard_feed_selector_following: () => 'Following',
  dashboard_feed_selector_combined: () => 'Both',
  dashboard_feed_selector_relays_label: () => 'Relays',
  dashboard_feed_selector_add_relay: () => 'Add relay…',
  dashboard_feed_selector_remove_relay: () => 'Remove relay',
  add_relay_modal_title: () => 'Add relay',
  add_relay_modal_placeholder: () => 'wss://relay.example.org',
  add_relay_modal_invalid: () => 'Enter a valid relay URL (wss://…)',
  add_relay_modal_confirm: () => 'Add',
  add_relay_modal_cancel: () => 'Cancel'
}));

const mockSettings = {
  dashboardFeedSource: 'communities',
  dashboardFeedRelay: '',
  dashboardCustomRelays: ['wss://custom.example/']
};

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  get appSettings() {
    return mockSettings;
  }
}));

vi.mock('$lib/stores/relay-feed-options.svelte.js', () => ({
  useRelayFeedOptions: () => () => [
    { url: 'wss://relay.example.org/', label: 'relay.example.org', isCustom: false },
    { url: 'wss://custom.example/', label: 'custom.example', isCustom: true }
  ]
}));

/** @type {{ feed: { relays: string[], relaySources?: string[] } }} */
const mockConfig = {
  feed: { relays: [], relaySources: ['config', 'custom', 'nip65', 'community'] }
};

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return mockConfig;
  }
}));

describe('DashboardFeedSelector', () => {
  beforeEach(() => {
    mockSettings.dashboardFeedSource = 'communities';
    mockSettings.dashboardFeedRelay = '';
    mockSettings.dashboardCustomRelays = ['wss://custom.example/'];
    mockConfig.feed = { relays: [], relaySources: ['config', 'custom', 'nip65', 'community'] };
  });

  it('renders the three base feed options', () => {
    const { getByText } = render(DashboardFeedSelector);
    expect(getByText('Following')).toBeTruthy();
    expect(getByText('Both')).toBeTruthy();
    // 'Communities' appears twice (active button + menu row)
    expect(document.body.textContent).toContain('Communities');
  });

  it('renders the Relays section with one row per relay option', () => {
    const { getByText } = render(DashboardFeedSelector);
    expect(getByText('Relays')).toBeTruthy();
    expect(getByText('relay.example.org')).toBeTruthy();
    expect(getByText('custom.example')).toBeTruthy();
  });

  it('renders an Add relay row', () => {
    const { getByText } = render(DashboardFeedSelector);
    expect(getByText('Add relay…')).toBeTruthy();
  });

  it('selecting a relay row switches source to relay and stores the URL', async () => {
    const { getByText } = render(DashboardFeedSelector);
    await fireEvent.click(getByText('relay.example.org'));
    expect(mockSettings.dashboardFeedSource).toBe('relay');
    expect(mockSettings.dashboardFeedRelay).toBe('wss://relay.example.org/');
  });

  it('shows a remove button only for custom relays', () => {
    const { getAllByLabelText } = render(DashboardFeedSelector);
    expect(getAllByLabelText('Remove relay')).toHaveLength(1);
  });

  it('removing the active custom relay falls back to communities', async () => {
    mockSettings.dashboardFeedSource = 'relay';
    mockSettings.dashboardFeedRelay = 'wss://custom.example/';
    const { getByLabelText } = render(DashboardFeedSelector);
    await fireEvent.click(getByLabelText('Remove relay'));
    expect(mockSettings.dashboardCustomRelays).toEqual([]);
    expect(mockSettings.dashboardFeedSource).toBe('communities');
    expect(mockSettings.dashboardFeedRelay).toBe('');
  });

  it('shows the relay host on the selector button when a relay feed is active', () => {
    mockSettings.dashboardFeedSource = 'relay';
    mockSettings.dashboardFeedRelay = 'wss://relay.example.org/';
    const { container } = render(DashboardFeedSelector);
    const button = container.querySelector('.dropdown > button');
    expect(button?.textContent).toContain('relay.example.org');
  });

  it('hides the Add relay row and modal when the custom source is disabled', () => {
    mockConfig.feed = { relays: ['wss://relay.edufeed.org/'], relaySources: ['config'] };
    const { queryByText, container } = render(DashboardFeedSelector);
    expect(queryByText('Add relay…')).toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('shows the Add relay row when the custom source is enabled', () => {
    mockConfig.feed = { relays: [], relaySources: ['config', 'custom'] };
    const { getByText } = render(DashboardFeedSelector);
    expect(getByText('Add relay…')).toBeTruthy();
  });

  it('falls back to the restricted default when relaySources is missing', () => {
    mockConfig.feed = { relays: [] };
    const { getByText } = render(DashboardFeedSelector);
    // default is config+custom → Add relay row present
    expect(getByText('Add relay…')).toBeTruthy();
  });
});
