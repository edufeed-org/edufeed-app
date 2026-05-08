/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { generateSignupKeypair } from '../helpers/signupKeypair.js';

describe('generateSignupKeypair', () => {
  it('returns a 32-byte private key and matching 64-char hex public key', () => {
    const { privateKey, publicKey } = generateSignupKeypair();

    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(privateKey.length).toBe(32);
    expect(typeof publicKey).toBe('string');
    expect(publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns nsec/npub that decode back to the same keys', () => {
    const { privateKey, publicKey, nsec, npub } = generateSignupKeypair();

    expect(nsec).toMatch(/^nsec1/);
    expect(npub).toMatch(/^npub1/);

    const decodedNsec = nip19.decode(nsec);
    const decodedNpub = nip19.decode(npub);

    expect(decodedNsec.type).toBe('nsec');
    expect(decodedNsec.data).toEqual(privateKey);
    expect(decodedNpub.type).toBe('npub');
    expect(decodedNpub.data).toBe(publicKey);
  });

  it('returns a signer that can sign an event matching the public key', async () => {
    const { publicKey, signer } = generateSignupKeypair();

    const draft = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'hello'
    };

    const signed = await signer.signEvent(draft);

    expect(signed.pubkey).toBe(publicKey);
    expect(typeof signed.sig).toBe('string');
    expect(signed.sig.length).toBe(128);
  });

  it('returns distinct keys on each call', () => {
    const a = generateSignupKeypair();
    const b = generateSignupKeypair();

    expect(a.publicKey).not.toBe(b.publicKey);
  });
});
