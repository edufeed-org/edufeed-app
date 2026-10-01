/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseConnectHash, connectPagePath } from '$lib/agents/pairing.js';

const CLIENT = 'b'.repeat(64);
const uri = `nostrconnect://${CLIENT}?relay=${encodeURIComponent('wss://groups.example')}&secret=s3cr3t&name=Edufeed+Agent`;

describe('parseConnectHash', () => {
  it('parses a raw uri hash', () => {
    expect(parseConnectHash('#' + uri)).toEqual({
      ok: true,
      uri,
      clientPubkey: CLIENT,
      relays: ['wss://groups.example'],
      secret: 's3cr3t',
      name: 'Edufeed Agent'
    });
  });
  it('parses an encoded uri hash (what connectPagePath produces)', () => {
    expect(
      parseConnectHash(
        connectPagePath(uri).split('#')[1] ? '#' + connectPagePath(uri).split('#')[1] : ''
      )
    ).toMatchObject({ ok: true, clientPubkey: CLIENT });
  });
  it('refuses missing, malformed and secret-less uris', () => {
    expect(parseConnectHash('')).toEqual({ ok: false, error: 'missing' });
    expect(parseConnectHash('#https://evil.example')).toEqual({ ok: false, error: 'invalid' });
    expect(parseConnectHash('#nostrconnect://nothex?relay=wss%3A%2F%2Fx&secret=s')).toEqual({
      ok: false,
      error: 'invalid'
    });
    expect(parseConnectHash(`#nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fx`)).toEqual({
      ok: false,
      error: 'no-secret'
    });
  });
});

describe('connectPagePath', () => {
  it('encodes the uri into the fragment', () => {
    expect(connectPagePath(uri)).toBe('/agents/connect#' + encodeURIComponent(uri));
  });
});
