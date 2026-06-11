import { nip19 } from 'nostr-tools';

/**
 * Resolve an npub / nprofile / note identifier to its canonical app path.
 *
 * - `npub`     → `/p/<npub>`
 * - `nprofile` → `/p/<npub>` (relay hints are dropped)
 * - `note`     → `/<reencoded nevent>` so the existing nevent route handles it
 *
 * Returns `null` for anything we don't translate (garbage, naddr, nevent, nsec).
 * nsec must never produce a redirect target.
 *
 * @param {string} identifier
 * @returns {string | null}
 */
export function resolveNostrShortcutRoute(identifier) {
  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return null;
  }
  switch (decoded.type) {
    case 'npub':
      return `/p/${nip19.npubEncode(decoded.data)}`;
    case 'nprofile':
      return `/p/${nip19.npubEncode(decoded.data.pubkey)}`;
    case 'note':
      return `/${nip19.neventEncode({ id: decoded.data })}`;
    default:
      return null;
  }
}
