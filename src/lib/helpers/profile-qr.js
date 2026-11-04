/**
 * Profile QR codes: what a profile's QR encodes, and where a scanned code
 * leads (issue 9f7816e3 — quick profile scanning on mobile).
 *
 * Pure functions, no DOM: the camera/decoder side lives in `qr-decoder.js`
 * and the UI in `components/profile/ProfileQrModal.svelte`.
 */
import { nip19 } from 'nostr-tools';
import { resolveNostrShortcutRoute } from '$lib/helpers/nostrShortcutRoute.js';
import { isNip05Address } from '$lib/helpers/nip05-verify.js';

/**
 * The payload a profile's QR code carries: a NIP-21 `nostr:` URI around the
 * npub. That is what Amethyst, Damus and Primal both show and scan; a bare
 * npub would still work for them but the scheme lets generic QR apps hand
 * the code to a Nostr client.
 *
 * @param {string} npub
 * @param {string} [pubkey] hex fallback when the caller has no npub yet
 * @returns {string}
 */
export function profileQrPayload(npub, pubkey = '') {
  const id = npub || (pubkey ? nip19.npubEncode(pubkey) : '');
  return id ? `nostr:${id}` : '';
}

const BECH32_RE =
  /\b(npub|nprofile|note|nevent|naddr|nsec)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}\b/i;
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;

/**
 * Translate a scanned QR payload into an app path, or `null` when the code
 * is not something we navigate to.
 *
 * Accepted: `nostr:` URIs and bare bech32 identifiers (npub, nprofile,
 * note, nevent, naddr — also upper-case, as QR alphanumeric mode writes
 * them), URLs with such an identifier in their path (`/p/<npub>`, njump,
 * other clients), a hex pubkey, and NIP-05 addresses. `nsec` never yields a
 * route: a private key in a QR is a leak, not a profile.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function resolveScannedNostrRoute(text) {
  const raw = (text ?? '').trim();
  if (!raw) return null;

  if (HEX_PUBKEY_RE.test(raw)) return `/p/${nip19.npubEncode(raw.toLowerCase())}`;
  if (isNip05Address(raw)) return resolveNostrShortcutRoute(raw);

  const match = raw.match(BECH32_RE);
  if (!match) return null;
  // bech32 is case-insensitive but only when the whole string shares one case.
  const id = match[0].toLowerCase();
  const kind = match[1].toLowerCase();
  if (kind === 'nsec') return null;
  if (kind === 'nevent' || kind === 'naddr') {
    try {
      nip19.decode(id);
    } catch {
      return null;
    }
    return `/${id}`;
  }
  return resolveNostrShortcutRoute(id);
}

const NSEC_RE = /\bnsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}\b/i;

/**
 * Whether a scanned payload carries a private key (an nsec backup QR, for
 * example). The scanner warns instead of treating it as an unknown code.
 * @param {string} text
 * @returns {boolean}
 */
export function containsPrivateKey(text) {
  return NSEC_RE.test(text ?? '');
}
