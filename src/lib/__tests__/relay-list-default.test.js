/**
 * getDefaultRelayList — the relay list a user should publish when they have none.
 * Must be UN-gated (unlike getFallbackRelays): a NIP-65 relay list is identity
 * infrastructure, so gated mode must not strip it to [] and leave new users with
 * no relay list. hasMailboxRelays — true when a kind 10002 advertises ≥1 relay.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({ runtimeConfig: { fallbackRelays: [] } }));
vi.mock('$lib/stores/config.svelte.js', () => mockConfig);

const mockAppSettings = vi.hoisted(() => ({ appSettings: { gatedMode: false } }));
vi.mock('$lib/stores/app-settings.svelte.js', () => mockAppSettings);

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: () => []
}));

import { getDefaultRelayList, hasMailboxRelays } from '$lib/helpers/relay-helper.js';

describe('getDefaultRelayList', () => {
  beforeEach(() => {
    mockConfig.runtimeConfig.fallbackRelays = ['wss://a.com/', 'wss://b.com/'];
    mockAppSettings.appSettings.gatedMode = false;
  });

  it('returns fallback relays when gated mode is OFF', () => {
    expect(getDefaultRelayList()).toEqual(['wss://a.com/', 'wss://b.com/']);
  });

  it('still returns fallback relays when gated mode is ON (un-gated)', () => {
    mockAppSettings.appSettings.gatedMode = true;
    expect(getDefaultRelayList()).toEqual(['wss://a.com/', 'wss://b.com/']);
  });

  it('returns [] when no fallback relays are configured', () => {
    mockConfig.runtimeConfig.fallbackRelays = undefined;
    expect(getDefaultRelayList()).toEqual([]);
  });
});

describe('hasMailboxRelays', () => {
  it('is false for a missing event', () => {
    expect(hasMailboxRelays(undefined)).toBe(false);
    expect(hasMailboxRelays(null)).toBe(false);
  });

  it('is false for an empty 10002 (no r tags)', () => {
    expect(hasMailboxRelays({ kind: 10002, tags: [], content: '' })).toBe(false);
  });

  it('is true for a 10002 with a bare r tag (read+write)', () => {
    expect(hasMailboxRelays({ kind: 10002, tags: [['r', 'wss://a.com/']], content: '' })).toBe(
      true
    );
  });

  it('is true for a 10002 with only a write-marked relay', () => {
    expect(
      hasMailboxRelays({ kind: 10002, tags: [['r', 'wss://a.com/', 'write']], content: '' })
    ).toBe(true);
  });
});
