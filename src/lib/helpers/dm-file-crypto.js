// AES-256-GCM decryption for NIP-17 kind-15 file messages. Same parameters as
// Amethyst (quartz nip17Dm/files) and dark-wisp (EncryptedMedia.kt): 12-byte
// nonce, 128-bit auth tag. WebCrypto only — no new dependency.

/** Algorithms we can decrypt. Anything else must surface, never silently fail. */
export const SUPPORTED_FILE_ALGORITHMS = ['aes-gcm'];

const TAG_BITS = 128;

/** @param {string} hex @param {string} label */
function hexToBytes(hex, label) {
  if (
    typeof hex !== 'string' ||
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    /[^0-9a-f]/i.test(hex)
  ) {
    throw new Error(`invalid hex for ${label}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * @param {BufferSource} encrypted
 * @param {{ algorithm: string, key: string, nonce: string }} material
 * @returns {Promise<Uint8Array>}
 */
export async function decryptFileBytes(encrypted, { algorithm, key, nonce }) {
  if (!SUPPORTED_FILE_ALGORITHMS.includes(String(algorithm).toLowerCase())) {
    throw new Error(`unsupported file encryption: ${algorithm}`);
  }
  const keyBytes = hexToBytes(key, 'key');
  const iv = hexToBytes(nonce, 'nonce');
  const subtle = globalThis.crypto.subtle;
  const cryptoKey = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_BITS },
    cryptoKey,
    encrypted
  );
  return new Uint8Array(plain);
}
