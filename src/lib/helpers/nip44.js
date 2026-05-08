/**
 * NIP-44 v2 encryption capability detection.
 *
 * Applesauce signers expose NIP-44 via the `nip44.encrypt` / `nip44.decrypt`
 * namespace (matches NIP-07's window.nostr shape). Some signer classes also
 * expose flat `nip44Encrypt` / `nip44Decrypt` methods, but `ExtensionSigner`
 * (the window.nostr proxy used for nos2x, Alby, etc.) does NOT — only the
 * namespace API is universal. Always use `signer.nip44.encrypt(pubkey, plaintext)`
 * and `signer.nip44.decrypt(pubkey, ciphertext)` and gate on `hasNip44(signer)`.
 *
 * @param {{ nip44?: { encrypt?: Function, decrypt?: Function } } | null | undefined} signer
 * @returns {boolean} true if the signer can both encrypt and decrypt with NIP-44
 */
export function hasNip44(signer) {
  return (
    typeof signer?.nip44?.encrypt === 'function' && typeof signer?.nip44?.decrypt === 'function'
  );
}
