/**
 * Compute the SHA-256 of a Blob's bytes and return it as a 64-character
 * lowercase hex string. Uses the platform's Web Crypto API; no dependencies.
 *
 * Loads the full blob into memory (via `arrayBuffer()`). For the Blossom
 * file-size limits this app enforces (single-digit MB) the cost is invisible;
 * streaming digests would be needed only for much larger files.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
