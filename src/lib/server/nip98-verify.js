/**
 * Shared NIP-98 (kind 27235) HTTP auth verifier.
 *
 * Verify a NIP-98 Authorization header against the request URL, method, and
 * raw body string. Returns the signer pubkey on success, or null on any
 * failure. Hashes the **raw body string** the client sent (matches what
 * `createNIP98AuthHeader` does in `src/lib/helpers/nip98.js`); using
 * `nip98.validateEvent` here would re-stringify the parsed body and produce
 * a different hash.
 */
import { verifyEvent } from 'nostr-tools/pure';

const TIMESTAMP_TOLERANCE_S = 60;

/**
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
 * @param {string | null} authHeader
 * @param {string} url
 * @param {string} method
 * @param {string} [rawBody]
 * @returns {Promise<string | null>}
 */
export async function verifyNip98Header(authHeader, url, method, rawBody) {
  if (!authHeader?.startsWith('Nostr ')) return null;
  let event;
  try {
    event = JSON.parse(atob(authHeader.slice(6)));
  } catch {
    return null;
  }
  if (!event || event.kind !== 27235) return null;
  if (!verifyEvent(event)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - (event.created_at ?? 0)) > TIMESTAMP_TOLERANCE_S) return null;

  const uTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'u');
  if (!uTag || uTag[1] !== url) return null;

  const methodTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'method');
  if (!methodTag || methodTag[1].toUpperCase() !== method.toUpperCase()) return null;

  if (rawBody) {
    const payloadTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'payload');
    if (!payloadTag) return null;
    const expected = await sha256Hex(rawBody);
    if (payloadTag[1] !== expected) return null;
  }

  return event.pubkey;
}
