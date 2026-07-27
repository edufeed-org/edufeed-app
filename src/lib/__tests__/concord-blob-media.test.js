// jsdom lacks crypto.subtle (see helpers/__tests__/sha256.test.js), so this
// runs in node, where Web Crypto is natively global.
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptBlob, fetchDecryptedBlobUrl } from '$lib/concord/blob-media.js';

/** @param {Uint8Array} bytes */
function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encrypt with the platform's own AES-256-GCM (the same primitive
 * `decryptBlob` uses) to produce a self-consistent round-trip test vector —
 * this is what CLAUDE.md/the task calls for when no external reference
 * ciphertext is available: verify our decrypt against our own encrypt using
 * the identical Web Crypto primitive, not a guessed byte layout.
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} keyBytes
 * @param {Uint8Array} nonceBytes
 */
async function encryptWithWebCrypto(plaintext, keyBytes, nonceBytes) {
  // See blob-media.js's matching comment: TS's lib.dom types plain
  // `Uint8Array` as `Uint8Array<ArrayBufferLike>`, not assignable to
  // `BufferSource` — a type-only mismatch, harmless at runtime.
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    /** @type {any} */ (keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: /** @type {any} */ (nonceBytes) },
    cryptoKey,
    /** @type {any} */ (plaintext)
  );
  return new Uint8Array(ciphertext);
}

describe('decryptBlob', () => {
  it('round-trips plaintext through AES-256-GCM with a 32-byte key and 16-byte nonce', async () => {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('a small community icon, pretend this is PNG bytes');

    const ciphertext = await encryptWithWebCrypto(plaintext, keyBytes, nonceBytes);
    const decrypted = await decryptBlob(ciphertext, toHex(keyBytes), toHex(nonceBytes));

    expect(new TextDecoder().decode(decrypted)).toBe(
      'a small community icon, pretend this is PNG bytes'
    );
  });

  it('round-trips arbitrary binary data (not just text)', async () => {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = crypto.getRandomValues(new Uint8Array(4096));

    const ciphertext = await encryptWithWebCrypto(plaintext, keyBytes, nonceBytes);
    const decrypted = await decryptBlob(ciphertext, toHex(keyBytes), toHex(nonceBytes));

    expect(toHex(decrypted)).toBe(toHex(plaintext));
  });

  it('rejects ciphertext decrypted with the wrong key (GCM auth tag fails)', async () => {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const wrongKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('secret icon bytes');

    const ciphertext = await encryptWithWebCrypto(plaintext, keyBytes, nonceBytes);
    await expect(
      decryptBlob(ciphertext, toHex(wrongKeyBytes), toHex(nonceBytes))
    ).rejects.toThrow();
  });

  it('rejects tampered ciphertext (auth tag no longer verifies)', async () => {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('secret icon bytes');

    const ciphertext = await encryptWithWebCrypto(plaintext, keyBytes, nonceBytes);
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    await expect(decryptBlob(tampered, toHex(keyBytes), toHex(nonceBytes))).rejects.toThrow();
  });

  it('rejects malformed hex', async () => {
    await expect(decryptBlob(new Uint8Array(16), 'not-hex', 'also-not-hex')).rejects.toThrow();
  });
});

describe('fetchDecryptedBlobUrl', () => {
  /** @type {Map<string, any>} */
  let cache;
  /** @type {Uint8Array} */
  let plaintext;
  /** @type {string} */
  let keyHex;
  /** @type {string} */
  let nonceHex;
  /** @type {string} */
  let hashHex;
  /** @type {Uint8Array} */
  let ciphertext;

  beforeEach(async () => {
    cache = new Map();
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
    plaintext = new TextEncoder().encode('icon bytes');
    keyHex = toHex(keyBytes);
    nonceHex = toHex(nonceBytes);
    ciphertext = await encryptWithWebCrypto(plaintext, keyBytes, nonceBytes);
    const digest = await crypto.subtle.digest('SHA-256', /** @type {any} */ (plaintext));
    hashHex = toHex(new Uint8Array(digest));
    vi.restoreAllMocks();
  });

  it('returns null for a missing/incomplete pointer without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchDecryptedBlobUrl(undefined, { cache })).toBeNull();
    expect(await fetchDecryptedBlobUrl({ url: 'https://x/blob' }, { cache })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches, decrypts, verifies the plaintext hash, and returns an object URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ ok: true, status: 200, arrayBuffer: async () => ciphertext.buffer })
    );
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-object-url');

    const pointer = {
      url: 'https://blossom.example/abc',
      key: keyHex,
      nonce: nonceHex,
      hash: hashHex
    };
    const result = await fetchDecryptedBlobUrl(pointer, { cache });

    expect(result).toBe('blob:mock-object-url');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  it('caches the resolved URL by hash — a second call does not re-fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        /** @type {any} */ ({ ok: true, status: 200, arrayBuffer: async () => ciphertext.buffer })
      );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-object-url');

    const pointer = {
      url: 'https://blossom.example/abc',
      key: keyHex,
      nonce: nonceHex,
      hash: hashHex
    };
    await fetchDecryptedBlobUrl(pointer, { cache });
    await fetchDecryptedBlobUrl(pointer, { cache });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null and warns once when the plaintext hash does not match the pointer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ ok: true, status: 200, arrayBuffer: async () => ciphertext.buffer })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pointer = {
      url: 'https://blossom.example/abc',
      key: keyHex,
      nonce: nonceHex,
      hash: 'f'.repeat(64) // wrong hash
    };
    const first = await fetchDecryptedBlobUrl(pointer, { cache });
    const second = await fetchDecryptedBlobUrl(pointer, { cache });

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1); // cached failure, not re-warned
  });

  it('returns null and warns when the network fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ ok: false, status: 404 })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pointer = {
      url: 'https://blossom.example/abc',
      key: keyHex,
      nonce: nonceHex,
      hash: hashHex
    };
    expect(await fetchDecryptedBlobUrl(pointer, { cache })).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null and warns when decryption fails (wrong key)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      /** @type {any} */ ({ ok: true, status: 200, arrayBuffer: async () => ciphertext.buffer })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pointer = {
      url: 'https://blossom.example/abc',
      key: toHex(crypto.getRandomValues(new Uint8Array(32))), // wrong key
      nonce: nonceHex,
      hash: hashHex
    };
    expect(await fetchDecryptedBlobUrl(pointer, { cache })).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
