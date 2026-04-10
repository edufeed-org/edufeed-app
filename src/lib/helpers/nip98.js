/**
 * NIP-98 HTTP Auth helper
 * Creates authorization headers for authenticated HTTP requests using Nostr events.
 */

/**
 * Compute SHA-256 hex digest of a string.
 * @param {string} str
 * @returns {Promise<string>}
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a NIP-98 HTTP Auth header.
 * @param {string} url - The request URL
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string|null} body - Request body (for payload hash)
 * @param {(draft: any) => Promise<any>} signer - Signs the event draft
 * @returns {Promise<string>} "Nostr <base64-encoded-signed-event>"
 */
export async function createNIP98AuthHeader(url, method, body, signer) {
  /** @type {string[][]} */
  const tags = [
    ['u', url],
    ['method', method]
  ];

  if (body) {
    const hash = await sha256Hex(body);
    tags.push(['payload', hash]);
  }

  const draft = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags
  };

  const signed = await signer(draft);
  return 'Nostr ' + btoa(JSON.stringify(signed));
}
