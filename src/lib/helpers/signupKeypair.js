import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { SimpleSigner } from 'applesauce-signers';

/**
 * Generate a fresh Nostr keypair plus a SimpleSigner for use during signup,
 * before the account is registered with the manager.
 *
 * @returns {{
 *   privateKey: Uint8Array,
 *   publicKey: string,
 *   nsec: string,
 *   npub: string,
 *   signer: import('applesauce-signers').SimpleSigner
 * }}
 */
export function generateSignupKeypair() {
  const privateKey = generateSecretKey();
  const publicKey = getPublicKey(privateKey);
  const nsec = nip19.nsecEncode(privateKey);
  const npub = nip19.npubEncode(publicKey);
  const signer = new SimpleSigner(privateKey);

  return { privateKey, publicKey, nsec, npub, signer };
}
