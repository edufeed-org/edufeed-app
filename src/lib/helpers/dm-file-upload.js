/**
 * Send side of NIP-17 kind-15 file messages: encrypt the file in the browser
 * (AES-256-GCM, fresh key and nonce — `dm-file-crypto.js`), upload ONLY the
 * ciphertext to the user's Blossom server as an opaque octet stream, and hand
 * back what `SendWrappedFile` puts into the rumor. The relay and the blob host
 * never see the plaintext; the receiver's DmFileMessage fetches by hash and
 * decrypts with the tags. The URL deliberately keeps no file extension — the
 * bytes are ciphertext, and an extension would only invite the host to serve
 * them under the plaintext's type.
 */
import { uploadWithFallback } from '$lib/helpers/blossom-upload.js';
import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
import { encryptFileBytes } from '$lib/helpers/dm-file-crypto.js';

/**
 * @param {File} file
 * @param {{signer: {getPublicKey: () => Promise<string>, signEvent: (e: any) => Promise<any>}}} opts
 * @returns {Promise<import('$lib/actions/dm-actions.js').DmFileInfo & { name: string }>}
 */
export async function uploadEncryptedDmFile(file, { signer }) {
  const { encrypted, algorithm, key, nonce } = await encryptFileBytes(await file.arrayBuffer());
  // getPublicKey(), not `.pubkey` — applesauce signers have no sync pubkey,
  // and reading it directly would skip the user's kind 10063 blossom server.
  const userPubkey = await signer.getPublicKey();
  const { blob, serverUrl } = await uploadWithFallback(
    new Blob([/** @type {BlobPart} */ (encrypted)], { type: 'application/octet-stream' }),
    { signer, userPubkey }
  );
  return {
    url: reconcileBlobUrlScheme(blob.url, serverUrl),
    fileType: file.type || 'application/octet-stream',
    algorithm,
    key,
    nonce,
    hash: blob.sha256,
    size: blob.size ?? encrypted.byteLength,
    name: file.name
  };
}
