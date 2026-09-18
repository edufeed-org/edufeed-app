// @ts-nocheck
/** @vitest-environment node */
/**
 * NIP-17 kind-15 payloads are AES-256-GCM (12-byte nonce, 128-bit tag) —
 * the same scheme Amethyst and dark-wisp use. Node 22 and every target
 * browser ship WebCrypto, so no dependency is added.
 */
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { decryptFileBytes, SUPPORTED_FILE_ALGORITHMS } from '$lib/helpers/dm-file-crypto.js';

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
