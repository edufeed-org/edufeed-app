// @ts-nocheck
/** @vitest-environment node */
/**
 * NIP-17 kind-15 payloads are AES-256-GCM (12-byte nonce, 128-bit tag) —
 * the same scheme Amethyst and dark-wisp use. Node 22 and every target
 * browser ship WebCrypto, so no dependency is added.
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  decryptFileBytes,
  encryptFileBytes,
  SUPPORTED_FILE_ALGORITHMS
} from '$lib/helpers/dm-file-crypto.js';

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function encryptFixture(plaintext) {
  const keyBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { encrypted, key: toHex(keyBytes), nonce: toHex(nonce) };
}

describe('decryptFileBytes', () => {
  it('round-trips an aes-gcm payload', async () => {
    const { encrypted, key, nonce } = await encryptFixture('hello file');
    const out = await decryptFileBytes(encrypted, { algorithm: 'aes-gcm', key, nonce });
    expect(new TextDecoder().decode(out)).toBe('hello file');
  });

  it('accepts the algorithm case-insensitively', async () => {
    const { encrypted, key, nonce } = await encryptFixture('x');
    await expect(
      decryptFileBytes(encrypted, { algorithm: 'AES-GCM', key, nonce })
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('rejects an unsupported algorithm without touching the bytes', async () => {
    const { encrypted, key, nonce } = await encryptFixture('x');
    await expect(
      decryptFileBytes(encrypted, { algorithm: 'chacha20', key, nonce })
    ).rejects.toThrow(/unsupported/i);
    expect(SUPPORTED_FILE_ALGORITHMS).toEqual(['aes-gcm']);
  });

  it('rejects a wrong key (GCM tag check fails)', async () => {
    const { encrypted, nonce } = await encryptFixture('x');
    await expect(
      decryptFileBytes(encrypted, { algorithm: 'aes-gcm', key: '11'.repeat(32), nonce })
    ).rejects.toThrow();
  });

  it('rejects malformed hex', async () => {
    const { encrypted, nonce } = await encryptFixture('x');
    await expect(
      decryptFileBytes(encrypted, { algorithm: 'aes-gcm', key: 'zz', nonce })
    ).rejects.toThrow(/hex|key/i);
  });
});

describe('encryptFileBytes', () => {
  it('produces aes-gcm material that decryptFileBytes round-trips', async () => {
    const plain = new TextEncoder().encode('a pasted screenshot');
    const { encrypted, algorithm, key, nonce } = await encryptFileBytes(plain);
    expect(algorithm).toBe('aes-gcm');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce).toMatch(/^[0-9a-f]{24}$/);
    // ciphertext + 16-byte GCM tag, and not the plaintext
    expect(encrypted.byteLength).toBe(plain.byteLength + 16);
    expect(new TextDecoder().decode(encrypted)).not.toContain('pasted');
    const out = await decryptFileBytes(encrypted, { algorithm, key, nonce });
    expect(new TextDecoder().decode(out)).toBe('a pasted screenshot');
  });

  it('draws a fresh key and nonce for every file', async () => {
    const a = await encryptFileBytes(new Uint8Array([1]));
    const b = await encryptFileBytes(new Uint8Array([1]));
    expect(a.key).not.toBe(b.key);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
