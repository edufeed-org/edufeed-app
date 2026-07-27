/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseCordnGroupsConfig } from '$lib/cordn/config.js';

const COORD_A = '3f86268a2abd47cb50147067d5868aa47a07a6fa6c4affde0cc67167aef073e2';
const COORD_B = '92753cbe63e943d0c4a0c61d745437892af6e98f179ce04a7a863aad4e00b1a5';

describe('parseCordnGroupsConfig', () => {
  it('returns disabled defaults for missing config', () => {
    expect(parseCordnGroupsConfig(undefined)).toEqual({
      enabled: false,
      coordinatorPubkeys: [],
      relays: []
    });
  });

  it('passes through a complete enabled config with multiple coordinators', () => {
    const parsed = parseCordnGroupsConfig({
      enabled: true,
      coordinatorPubkeys: [COORD_A, COORD_B],
      relays: ['wss://relay.contextvm.org']
    });
    expect(parsed).toEqual({
      enabled: true,
      coordinatorPubkeys: [COORD_A, COORD_B],
      relays: ['wss://relay.contextvm.org']
    });
  });

  it('drops malformed coordinator pubkeys and dedupes', () => {
    const parsed = parseCordnGroupsConfig({
      enabled: true,
      coordinatorPubkeys: [COORD_A, 'nothex', '', COORD_A, COORD_B],
      relays: ['wss://r.example']
    });
    expect(parsed.coordinatorPubkeys).toEqual([COORD_A, COORD_B]);
    expect(parsed.enabled).toBe(true);
  });

  it('forces enabled=false when no valid coordinator pubkey remains', () => {
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkeys: ['nothex'], relays: ['wss://r'] })
        .enabled
    ).toBe(false);
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkeys: [], relays: ['wss://r'] }).enabled
    ).toBe(false);
  });

  it('forces enabled=false when no relays are configured', () => {
    expect(
      parseCordnGroupsConfig({ enabled: true, coordinatorPubkeys: [COORD_A], relays: [] }).enabled
    ).toBe(false);
  });

  it('drops non-websocket relay URLs', () => {
    const parsed = parseCordnGroupsConfig({
      enabled: true,
      coordinatorPubkeys: [COORD_A],
      relays: ['wss://good.example', 'https://bad.example', '']
    });
    expect(parsed.relays).toEqual(['wss://good.example']);
  });
});
