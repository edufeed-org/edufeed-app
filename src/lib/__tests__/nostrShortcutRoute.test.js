/**
 * Tests for resolveNostrShortcutRoute: maps npub/nprofile/note identifiers to
 * their canonical app paths (or null for anything we don't translate).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { resolveNostrShortcutRoute } from '../helpers/nostrShortcutRoute.js';

const HEX_PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const HEX_EVENT_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('resolveNostrShortcutRoute', () => {
  it('maps npub → /p/<hex>', () => {
    const npub = nip19.npubEncode(HEX_PUBKEY);
    expect(resolveNostrShortcutRoute(npub)).toBe(`/p/${HEX_PUBKEY}`);
  });

  it('maps nprofile → /p/<hex> and drops relay hints', () => {
    const nprofile = nip19.nprofileEncode({
      pubkey: HEX_PUBKEY,
      relays: ['wss://relay.example.com', 'wss://other.example.com']
    });
    const target = resolveNostrShortcutRoute(nprofile);
    expect(target).toBe(`/p/${HEX_PUBKEY}`);
    expect(target).not.toContain('relay');
  });

  it('maps note → /nevent where the encoded id round-trips', () => {
    const note = nip19.noteEncode(HEX_EVENT_ID);
    const target = resolveNostrShortcutRoute(note);
    expect(target).toMatch(/^\/nevent1[a-z0-9]+$/);
    if (target === null) throw new Error('unreachable'); // narrow for TS

    // Round-trip: decoding the result must yield the same id
    const neventStr = target.slice(1);
    const decoded = nip19.decode(neventStr);
    expect(decoded.type).toBe('nevent');
    if (decoded.type !== 'nevent') throw new Error('unreachable');
    expect(decoded.data.id).toBe(HEX_EVENT_ID);
  });

  it('returns null for garbage / invalid bech32', () => {
    expect(resolveNostrShortcutRoute('garbage')).toBeNull();
    expect(resolveNostrShortcutRoute('npub1xxxxx')).toBeNull();
    expect(resolveNostrShortcutRoute('')).toBeNull();
  });

  it('returns null for nsec (must never produce a redirect target)', () => {
    // Use a deterministic dummy 32-byte secret key — we never use it.
    const dummy = new Uint8Array(32);
    dummy.fill(1);
    const nsec = nip19.nsecEncode(dummy);
    expect(resolveNostrShortcutRoute(nsec)).toBeNull();
  });
});
