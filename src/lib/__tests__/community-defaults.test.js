/**
 * Tests for the defaults a new community definition (kind 10222) starts with.
 * They must come from the deployment config, never from a literal: the old
 * hardcoded `wss://relay.edufeed.org` sent every test-setup and whitelabel
 * community to the edufeed production relay via its r-tags.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @type {{ communikey: string[] }} */
const appRelays = { communikey: [] };
/** @type {{ runtimeConfig: { defaultBlossomServers: string[] | undefined } }} */
const mockConfig = { runtimeConfig: { defaultBlossomServers: [] } };

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: (/** @type {string} */ category) =>
    category === 'communikey' ? appRelays.communikey : []
}));
vi.mock('$lib/stores/config.svelte.js', () => mockConfig);

const { getDefaultCommunityRelays, getDefaultCommunityBlossomServers } = await import(
  '$lib/helpers/community-defaults.js'
);

describe('getDefaultCommunityRelays', () => {
  beforeEach(() => {
    appRelays.communikey = [];
  });

  it('returns the configured communikey relays as bare r-tag URLs', () => {
    appRelays.communikey = ['ws://localhost:17003/', 'wss://relay.example.org'];
    expect(getDefaultCommunityRelays()).toEqual([
      'ws://localhost:17003',
      'wss://relay.example.org'
    ]);
  });

  it('dedupes relays that differ only by trailing slash', () => {
    appRelays.communikey = ['wss://relay.example.org/', 'wss://relay.example.org'];
    expect(getDefaultCommunityRelays()).toEqual(['wss://relay.example.org']);
  });

  it('never invents a relay when none is configured', () => {
    expect(getDefaultCommunityRelays()).toEqual([]);
  });

  it('returns a fresh array each call (callers bind it to editable state)', () => {
    appRelays.communikey = ['wss://relay.example.org'];
    expect(getDefaultCommunityRelays()).not.toBe(getDefaultCommunityRelays());
  });
});

describe('getDefaultCommunityBlossomServers', () => {
  beforeEach(() => {
    mockConfig.runtimeConfig.defaultBlossomServers = [];
  });

  it('returns the deployment default blossom servers', () => {
    mockConfig.runtimeConfig.defaultBlossomServers = ['http://localhost:13000'];
    expect(getDefaultCommunityBlossomServers()).toEqual(['http://localhost:13000']);
  });

  it('returns [] when the deployment configures none', () => {
    mockConfig.runtimeConfig.defaultBlossomServers = undefined;
    expect(getDefaultCommunityBlossomServers()).toEqual([]);
  });

  it('returns a copy, not the config array', () => {
    const servers = ['https://blossom.example.org'];
    mockConfig.runtimeConfig.defaultBlossomServers = servers;
    expect(getDefaultCommunityBlossomServers()).not.toBe(servers);
  });
});

// The two community editors render too much (Concord, groups, signers) to
// mount here; guard their source instead so a literal default cannot return.
describe('community editors take no hardcoded relay or blossom default', () => {
  it.each([
    'src/lib/components/CreateCommunityModal.svelte',
    'src/lib/components/community/settings/CommunityBasicsForm.svelte'
  ])('%s', async (file) => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/['"](wss?:\/\/)?[a-z0-9.-]+\.edufeed\.org/);
  });
});
