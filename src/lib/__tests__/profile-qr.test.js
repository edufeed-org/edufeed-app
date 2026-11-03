/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { profileQrPayload, resolveScannedNostrRoute } from '$lib/helpers/profile-qr.js';

const HEX = 'a'.repeat(64);
const NPUB = nip19.npubEncode(HEX);

describe('profileQrPayload', () => {
  it('encodes the npub as a NIP-21 nostr: URI (what Amethyst/Damus scanners read)', () => {
    expect(profileQrPayload(NPUB)).toBe(`nostr:${NPUB}`);
  });

  it('derives the npub from a hex pubkey when no npub is given', () => {
    expect(profileQrPayload('', HEX)).toBe(`nostr:${NPUB}`);
  });
});

describe('resolveScannedNostrRoute', () => {
  it('routes nostr:npub to the profile page', () => {
    expect(resolveScannedNostrRoute(`nostr:${NPUB}`)).toBe(`/p/${NPUB}`);
  });

  it('routes a bare npub and ignores surrounding whitespace', () => {
    expect(resolveScannedNostrRoute(`  ${NPUB}\n`)).toBe(`/p/${NPUB}`);
  });

  it('accepts the upper-case form QR alphanumeric mode produces', () => {
    expect(resolveScannedNostrRoute(`NOSTR:${NPUB.toUpperCase()}`)).toBe(`/p/${NPUB}`);
  });

  it('routes nprofile to the profile page and drops relay hints', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: HEX, relays: ['wss://relay.example.com'] });
    expect(resolveScannedNostrRoute(`nostr:${nprofile}`)).toBe(`/p/${NPUB}`);
  });

  it('routes a hex pubkey to the profile page', () => {
    expect(resolveScannedNostrRoute(HEX)).toBe(`/p/${NPUB}`);
  });

  it('routes an app profile URL by its npub segment', () => {
    expect(resolveScannedNostrRoute(`https://edufeed.org/p/${NPUB}`)).toBe(`/p/${NPUB}`);
  });

  it('routes a NIP-05 address to the profile page', () => {
    expect(resolveScannedNostrRoute('Maria@Edufeed.org')).toBe('/p/maria@edufeed.org');
  });

  it('routes note / nevent / naddr codes to their event routes', () => {
    const id = 'b'.repeat(64);
    const nevent = nip19.neventEncode({ id });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: HEX, identifier: 'x' });
    expect(resolveScannedNostrRoute(`nostr:${nevent}`)).toBe(`/${nevent}`);
    expect(resolveScannedNostrRoute(naddr)).toBe(`/${naddr}`);
    expect(resolveScannedNostrRoute(nip19.noteEncode(id))).toBe(`/${nevent}`);
  });

  it('refuses nsec, garbage and plain web URLs', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    expect(resolveScannedNostrRoute(`nostr:${nsec}`)).toBeNull();
    expect(resolveScannedNostrRoute('WIFI:S:home;;')).toBeNull();
    expect(resolveScannedNostrRoute('https://example.com/')).toBeNull();
    expect(resolveScannedNostrRoute('')).toBeNull();
  });
});

describe('containsPrivateKey', () => {
  it('spots an nsec so the scanner can warn instead of silently ignoring it', async () => {
    const { containsPrivateKey } = await import('$lib/helpers/profile-qr.js');
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    expect(containsPrivateKey(`nostr:${nsec}`)).toBe(true);
    expect(containsPrivateKey(nsec.toUpperCase())).toBe(true);
    expect(containsPrivateKey(NPUB)).toBe(false);
    expect(containsPrivateKey('')).toBe(false);
  });
});
