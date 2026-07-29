/**
 * NIP-44 signer-surface adapters. Different signers expose either a nested
 * `signer.nip44.{encrypt,decrypt}` or flat `signer.nip44Encrypt/-Decrypt`
 * API; every forms call site goes through these helpers.
 */

/** @param {any} signer @param {string} counterpartyPubkey @param {string} plaintext */
export async function nip44EncryptWith(signer, counterpartyPubkey, plaintext) {
  if (signer?.nip44?.encrypt) return signer.nip44.encrypt(counterpartyPubkey, plaintext);
  if (signer?.nip44Encrypt) return signer.nip44Encrypt(counterpartyPubkey, plaintext);
  throw new Error('Signer does not support NIP-44 encryption');
}

/** @param {any} signer @param {string} counterpartyPubkey @param {string} ciphertext */
export async function nip44DecryptWith(signer, counterpartyPubkey, ciphertext) {
  if (signer?.nip44?.decrypt) return signer.nip44.decrypt(counterpartyPubkey, ciphertext);
  if (signer?.nip44Decrypt) return signer.nip44Decrypt(counterpartyPubkey, ciphertext);
  throw new Error('Signer does not support NIP-44 decryption');
}

/** @param {any} signer */
export function signerHasNip44(signer) {
  return !!(signer?.nip44?.decrypt || signer?.nip44Decrypt);
}

/**
 * Whether the signer can ENCRYPT with NIP-44. Deliberately separate from
 * signerHasNip44, which asks about decryption: a prefill site needs decrypt,
 * a submit site needs encrypt, and a signer offering only one would otherwise
 * pass the wrong guard and throw halfway through.
 *
 * @param {any} signer
 */
export function signerCanNip44Encrypt(signer) {
  return !!(signer?.nip44?.encrypt || signer?.nip44Encrypt);
}
