/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { sealPayload, unsealPayload } from '$lib/cordn/sealed-payload.js';

const key = new Uint8Array(32).fill(7);
const otherKey = new Uint8Array(32).fill(8);
const message = new TextEncoder().encode('opaque mls message bytes');

describe('sealed payload (Cordn spec/03 §4–5)', () => {
  it('round-trips plaintext bytes', () => {
    const sealed = sealPayload({ key, plaintext: message });
    expect(typeof sealed).toBe('string');
    const opened = unsealPayload({ key, sealedBase64: sealed });
    expect(new TextDecoder().decode(opened)).toBe('opaque mls message bytes');
  });

  it('produces a fresh nonce per seal (no identical ciphertexts)', () => {
    const a = sealPayload({ key, plaintext: message });
    const b = sealPayload({ key, plaintext: message });
    expect(a).not.toBe(b);
  });

  it('wire format is base64(nonce||ciphertext+tag), minimum 28 bytes', () => {
    const sealed = sealPayload({ key, plaintext: new Uint8Array(0) });
    const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(12 + 16);
  });

  it('rejects payloads shorter than nonce+tag', () => {
    const short = btoa(String.fromCharCode(...new Uint8Array(27)));
    expect(() => unsealPayload({ key, sealedBase64: short })).toThrow(/short/i);
  });

  it('rejects tampered ciphertext (AEAD failure)', () => {
    const sealed = sealPayload({ key, plaintext: message });
    const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = btoa(String.fromCharCode(...bytes));
    expect(() => unsealPayload({ key, sealedBase64: tampered })).toThrow();
  });

  it('rejects the wrong key', () => {
    const sealed = sealPayload({ key, plaintext: message });
    expect(() => unsealPayload({ key: otherKey, sealedBase64: sealed })).toThrow();
  });
});
