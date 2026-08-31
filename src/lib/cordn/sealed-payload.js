/**
 * Cordn spec/03 §4–§5 — sealed group payloads.
 * Wire format: base64( 12-byte nonce || ChaCha20-Poly1305 ciphertext+16-byte tag ),
 * empty AAD. The 32-byte key comes from the MLS exporter (label "cordn",
 * context "group-payload") — derivation lives with the MLS client so this
 * module stays pure and testable.
 *
 * Adapted from cordn-web's chatGroupPayloadCrypto.ts (MIT, © 2026 the Cordn
 * contributors).
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, randomBytes } from '@noble/ciphers/utils.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const EMPTY_AAD = new Uint8Array(0);

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** @param {string} value */
function fromBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/**
 * Seal opaque payload bytes under the current epoch's exporter key.
 *
 * @param {{key: Uint8Array, plaintext: Uint8Array}} params
 * @returns {string} base64-encoded SealedPayload
 */
export function sealPayload({ key, plaintext }) {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = chacha20poly1305(key, nonce, EMPTY_AAD).encrypt(plaintext);
  return toBase64(concatBytes(nonce, ciphertext));
}

/**
 * Unseal a SealedPayload. Throws on malformed input, short payloads, or AEAD
 * verification failure (spec/03 §7).
 *
 * @param {{key: Uint8Array, sealedBase64: string}} params
 * @returns {Uint8Array} plaintext bytes
 */
export function unsealPayload({ key, sealedBase64 }) {
  const payload = fromBase64(sealedBase64);
  if (payload.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error('Sealed payload too short');
  }
  const nonce = payload.subarray(0, NONCE_BYTES);
  const ciphertext = payload.subarray(NONCE_BYTES);
  return chacha20poly1305(key, nonce, EMPTY_AAD).decrypt(ciphertext);
}
