/**
 * Blossom upload for chat attachments (NIP-29 room messages). Returns the
 * NIP-94-style fields that become the message's NIP-92 imeta tag — no license
 * lookup: chat files aren't published OER (that gate belongs to the resource
 * form, see upload-and-find-license.js).
 */
import { uploadWithFallback } from '$lib/helpers/blossom-upload.js';
import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';

/**
 * Append the original filename's extension to a content-addressed blob URL
 * whose path has none. Armada does the same on upload: media detection (ours
 * and other clients') keys on the URL extension.
 * @param {string} urlString
 * @param {string} filename
 * @returns {string}
 */
export function appendExtensionIfMissing(urlString, filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return urlString;
  const ext = filename.slice(dot).toLowerCase();
  try {
    const url = new URL(urlString);
    const lastSegment = url.pathname.split('/').pop() ?? '';
    if (lastSegment.includes('.')) return urlString;
    url.pathname += ext;
    return url.toString();
  } catch {
    return urlString;
  }
}

/**
 * @param {File} file
 * @param {{signer: {getPublicKey: () => Promise<string>, signEvent: (e: any) => Promise<any>}}} opts
 * @returns {Promise<{url: string, type: string, sha256: string, size: number, name: string}>}
 */
export async function uploadChatAttachment(file, { signer }) {
  // getPublicKey(), not `.pubkey` — applesauce signers have no sync pubkey,
  // and reading it directly would skip the user's kind 10063 blossom server.
  const userPubkey = await signer.getPublicKey();
  const { blob, serverUrl } = await uploadWithFallback(file, { signer, userPubkey });
  return {
    url: appendExtensionIfMissing(reconcileBlobUrlScheme(blob.url, serverUrl), file.name),
    type: blob.type || file.type || 'application/octet-stream',
    sha256: blob.sha256,
    size: blob.size ?? file.size ?? 0,
    name: file.name
  };
}
