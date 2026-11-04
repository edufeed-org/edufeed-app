/** @vitest-environment node */
/**
 * NIP-46 permissions requested at connect time (laoc, 2026-11-04: "NIP-46
 * login broken?"). Amber only auto-signs kinds the client asked for when it
 * connected; everything else lands in its approval queue, and the app's
 * slow-signer toast ("Waiting for your signing app…") shows for as long as
 * the user has not opened Amber. Login itself signs a kind 22242 AUTH for the
 * groups relay, so without permissions every bunker login ended in that toast.
 */
import { describe, it, expect } from 'vitest';
import {
  NIP46_SIGNED_KINDS,
  NIP46_ENCRYPTION_PERMISSIONS,
  buildNip46Permissions
} from '$lib/helpers/nip46-permissions.js';
import { IDENTITY_KINDS } from '$lib/helpers/identity-kinds.js';
import { createNostrConnectURI } from 'applesauce-signers/helpers/nostr-connect';
import QRCode from 'qrcode';

describe('NIP46_SIGNED_KINDS', () => {
  it('is a sorted list of unique kind numbers', () => {
    expect(NIP46_SIGNED_KINDS.length).toBeGreaterThan(0);
    expect(new Set(NIP46_SIGNED_KINDS).size).toBe(NIP46_SIGNED_KINDS.length);
    expect(NIP46_SIGNED_KINDS).toEqual([...NIP46_SIGNED_KINDS].sort((a, b) => a - b));
    for (const kind of NIP46_SIGNED_KINDS) expect(Number.isInteger(kind) && kind >= 0).toBe(true);
  });

  it('covers what the app signs without the user asking: relay AUTH, DM seals, app data', () => {
    expect(NIP46_SIGNED_KINDS).toContain(22242); // NIP-42 AUTH (groups relay challenges on connect)
    expect(NIP46_SIGNED_KINDS).toContain(13); // NIP-17 seal
    expect(NIP46_SIGNED_KINDS).toContain(30078); // NIP-78 inbox last-seen marker
    expect(NIP46_SIGNED_KINDS).toContain(24242); // Blossom upload auth
    expect(NIP46_SIGNED_KINDS).toContain(27235); // NIP-98 (LiveKit token)
  });

  it('covers every kind of one user action: joining a channel signs 9021 and 10009', () => {
    for (const kind of [9021, 9022, 10009]) expect(NIP46_SIGNED_KINDS).toContain(kind);
  });

  it('covers the webxdc frames an app signs while it runs', () => {
    for (const kind of [9450, 24450]) expect(NIP46_SIGNED_KINDS).toContain(kind);
  });

  it('covers the identity kinds and the calendar kinds', () => {
    for (const kind of IDENTITY_KINDS)
      expect(NIP46_SIGNED_KINDS, `identity ${kind}`).toContain(kind);
    for (const kind of [31922, 31923, 31924, 31925]) expect(NIP46_SIGNED_KINDS).toContain(kind);
  });
});

describe('buildNip46Permissions', () => {
  it('lists get_public_key, one sign_event:<kind> per kind and the encryption methods', () => {
    const perms = buildNip46Permissions([1, 22242]);
    expect(perms).toEqual([
      'get_public_key',
      'sign_event:1',
      'sign_event:22242',
      ...NIP46_ENCRYPTION_PERMISSIONS
    ]);
    expect(NIP46_ENCRYPTION_PERMISSIONS).toEqual([
      'nip04_encrypt',
      'nip04_decrypt',
      'nip44_encrypt',
      'nip44_decrypt'
    ]);
  });

  it('never emits a bare sign_event — Amber drops a sign_event permission without a kind', () => {
    const perms = buildNip46Permissions();
    expect(perms).not.toContain('sign_event');
    expect(perms.filter((p) => p.startsWith('sign_event:'))).toHaveLength(
      NIP46_SIGNED_KINDS.length
    );
    expect(perms[0]).toBe('get_public_key');
    expect(new Set(perms).size).toBe(perms.length);
  });
});

describe('nostrconnect:// URI with the permissions', () => {
  // The real URI as LoginWithBunker shows it: client pubkey, secret, app
  // metadata, the rendezvous relay plus a typical fallback set.
  const uri = createNostrConnectURI({
    client: 'a'.repeat(64),
    connectSecret: '0123456789abcdef',
    relays: [
      'wss://relay.nsec.app',
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nostr.wine',
      'wss://relay.edufeed.org'
    ],
    metadata: {
      name: 'Edufeed',
      url: 'https://edufeed.org',
      permissions: buildNip46Permissions()
    }
  });

  it('carries the permissions as `perms` (applesauce-signers contract the login relies on)', () => {
    const params = new URL(uri.replace('nostrconnect://', 'https://x/')).searchParams;
    expect(params.get('perms')?.split(',')).toEqual(buildNip46Permissions());
    expect(uri).toContain('perms=get_public_key%2Csign_event%3A0%2C');
  });

  it('fits a QR code a phone can scan from a laptop screen (version <= 25 at EC L)', () => {
    // LoginWithBunker renders at 320 px with error correction L: version 25
    // is 117 modules, ~2.5 px per module. The full kind catalogue would be
    // version 36 at 1.5 px per module, which phone cameras cannot resolve.
    const { version } = QRCode.create(uri, { errorCorrectionLevel: 'L' });
    expect(version).toBeLessThanOrEqual(25);
  });
});
