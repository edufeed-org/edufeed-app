/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { match } from '../../params/nevent.js';
import { nip19 } from 'nostr-tools';

describe('nevent param matcher', () => {
  it('matches valid nevent strings', () => {
    const nevent = nip19.neventEncode({
      id: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
    });
    expect(match(nevent)).toBe(true);
  });

  it('matches nevent with relay hints', () => {
    const nevent = nip19.neventEncode({
      id: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      relays: ['wss://relay.example.com']
    });
    expect(match(nevent)).toBe(true);
  });

  it('rejects naddr strings', () => {
    const naddr = nip19.naddrEncode({
      kind: 30142,
      pubkey: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      identifier: 'test'
    });
    expect(match(naddr)).toBe(false);
  });

  it('rejects npub strings', () => {
    const npub = nip19.npubEncode(
      'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
    );
    expect(match(npub)).toBe(false);
  });

  it('rejects random strings', () => {
    expect(match('hello')).toBe(false);
    expect(match('')).toBe(false);
    expect(match('nevent')).toBe(false);
  });
});
