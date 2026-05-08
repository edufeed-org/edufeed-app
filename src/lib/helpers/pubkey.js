/**
 * Pubkey normalization helpers.
 *
 * Kept dependency-light (only `nostr-tools/nip19`) so it's safe to import
 * from components running under jsdom where heavier modules in the stack
 * (relay-helper → app-settings → window.matchMedia) would fail.
 */

import { nip19 } from 'nostr-tools';

/**
 * Accept an npub1… or 64-char hex string, return lowercase hex.
 * Returns null for any input that does not parse as a Nostr public key.
 *
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizePubkey(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') return /** @type {string} */ (decoded.data);
    } catch {
      return null;
    }
  }
  return null;
}
