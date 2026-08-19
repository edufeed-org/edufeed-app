/**
 * Private, unpredictable sandbox subdomain per app: base36(HMAC-SHA256(seed, appKey)).
 * The seed is device-local so no third party can guess another app's subdomain
 * and reach its origin-keyed storage (iframe.diy security note).
 */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

const SEED_KEY = 'edufeed:webxdc-sandbox-seed';
const LABEL_LENGTH = 50; // base36 of 32 bytes, zero-padded; fits the 63-char DNS label limit

function getSeed() {
  try {
    const stored = localStorage.getItem(SEED_KEY);
    if (stored) return stored;
    const seed = globalThis.crypto.randomUUID();
    localStorage.setItem(SEED_KEY, seed);
    return seed;
  } catch {
    return 'edufeed-ephemeral-sandbox-seed'; // private mode fallback: per-session only
  }
}

/** @param {string} appKey @returns {string} */
export function sandboxSubdomain(appKey) {
  const mac = hmac(sha256, new TextEncoder().encode(getSeed()), new TextEncoder().encode(appKey));
  let n = 0n;
  for (const byte of mac) n = (n << 8n) | BigInt(byte);
  return n.toString(36).padStart(LABEL_LENGTH, '0').slice(-LABEL_LENGTH);
}
