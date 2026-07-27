/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseCordnGroupsConfig } from '$lib/cordn/config.js';

const COORD = '3f86268a2abd47cb50147067d5868aa47a07a6fa6c4affde0cc67167aef073e2';

describe('parseCordnGroupsConfig', () => {
  it('returns disabled defaults for missing config', () => {
    expect(parseCordnGroupsConfig(undefined)).toEqual({
      enabled: false,
      coordinatorPubkey: '',
      relays: []
    });
  });

  it('passes through a complete enabled config', () => {
    const parsed = parseCordnGroupsConfig({
      enabled: true,
      coordinatorPubkey: COORD,
      relays: ['wss://relay.contextvm.org']
    });
    expect(parsed).toEqual({
      enabled: true,
      coordinatorPubkey: COORD,
      relays: ['wss://relay.contextvm.org']
    });
  });

  it('forces enabled=false when the coordinator pubkey is missing or malformed', () => {
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkey: '', relays: ['wss://r'] }).enabled
    ).toBe(false);
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkey: 'nothex', relays: ['wss://r'] })
        .enabled
    ).toBe(false);
  });

  it('forces enabled=false when no relays are configured', () => {
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkey: COORD, relays: [] }).enabled
    ).toBe(false);
  });

  it('drops non-websocket relay URLs', () => {
    const parsed = parseCordnGroupsConfig({
      enabled: true,
      coordinatorPubkey: COORD,
      relays: ['wss://good.example', 'https://bad.example', '']
    });
    expect(parsed.relays).toEqual(['wss://good.example']);
  });
});
