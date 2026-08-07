// CORD.md zaps in Concord channels: a kind-9735 rumor authored by the PAYER
// (not an LNURL server — there is none inside a sealed channel), carrying the
// invoice (`bolt11`), the settlement `preimage` as the payment proof, and an
// `amount` (msat). Every member verifies locally:
//   sha256(preimage) == bolt11 payment_hash  AND  amount tag == invoice amount
// Unverified receipts NEVER enter tallies. Kind-8333 on-chain zaps carry a
// `bitcoin:tx:<txid>` i-tag instead — the public ledger is the proof.
// Semantics verified against Armada's shared zap module; implementation ours.
//
// Package imports: light-bolt11-decoder only (pure JS, SSR-safe, already in
// the dependency tree transitively — added as a direct dep for this module).
// Hashing uses WebCrypto like blob-media.js, so verifyZapRumor is async;
// callers cache verdicts per rumor id (tags never change).
import { decode as decodeBolt11 } from 'light-bolt11-decoder';

/** @param {{tags?: string[][]}} rumor @param {string} name */
function tagValue(rumor, name) {
  return rumor.tags?.find((t) => t[0] === name)?.[1];
}

/** @param {Uint8Array} bytes */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** @param {string} hex */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Amount (msat) and payment hash of a BOLT-11 invoice, nulls when
 * undecodable or amountless (amountless invoices are not zappable — the
 * amount tag would be unverifiable).
 * @param {string} invoice
 * @returns {{amountMsats: number | null, paymentHash: string | null}}
 */
export function bolt11Info(invoice) {
  try {
    const decoded = decodeBolt11(invoice.trim());
    let amountMsats = null;
    let paymentHash = null;
    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        const n = Number(section.value);
        if (Number.isFinite(n) && n > 0) amountMsats = n;
      } else if (section.name === 'payment_hash' && typeof section.value === 'string') {
        paymentHash = section.value.toLowerCase();
      }
    }
    return { amountMsats, paymentHash };
  } catch {
    return { amountMsats: null, paymentHash: null };
  }
}

/**
 * Verify a CORD.md Lightning zap rumor. Resolves to the payment hash when
 * valid (use it to dedupe — one payment counts once), null otherwise.
 * `deps.bolt11Info` is injectable for tests; production uses the real decoder.
 * @param {{kind?: number, tags?: string[][]}} rumor
 * @param {{bolt11Info?: (invoice: string) => {amountMsats: number | null, paymentHash: string | null}}} [deps]
 * @returns {Promise<string | null>}
 */
export async function verifyZapRumor(rumor, deps = {}) {
  const info = deps.bolt11Info ?? bolt11Info;
  if (rumor.kind !== 9735) return null;
  const bolt11 = tagValue(rumor, 'bolt11');
  const preimage = tagValue(rumor, 'preimage');
  const amount = Number(tagValue(rumor, 'amount'));
  if (!bolt11 || !preimage || !/^[0-9a-f]{64}$/.test(preimage)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const { amountMsats, paymentHash } = info(bolt11);
  if (!paymentHash || amountMsats === null) return null;
  if (amountMsats !== amount) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', /** @type {any} */ (hexToBytes(preimage)));
    return bytesToHex(new Uint8Array(digest)) === paymentHash ? paymentHash : null;
  } catch {
    return null;
  }
}

/**
 * Verify a kind-8333 on-chain zap rumor: `i` tag `bitcoin:tx:<64-hex txid>`
 * plus a positive `amount` (sats). Returns the txid (the dedupe proof) or null.
 * @param {{kind?: number, tags?: string[][]}} rumor
 * @returns {string | null}
 */
export function verifyOnchainZapRumor(rumor) {
  if (rumor.kind !== 8333) return null;
  const i = tagValue(rumor, 'i');
  const amount = Number(tagValue(rumor, 'amount'));
  if (!i || !i.startsWith('bitcoin:tx:')) return null;
  const txid = i.slice('bitcoin:tx:'.length);
  if (!/^[0-9a-f]{64}$/.test(txid)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return txid;
}

/**
 * @typedef {{target: string, proof: string, pubkey: string, msats: number, ms: number}} VerifiedZap
 */

/**
 * Sum verified zaps per target message. Dedupe key is the payment PROOF
 * (payment hash / txid), never the rumor id — a relay echo re-delivers the
 * same payment under a fresh rumor and must not double-count.
 * @param {VerifiedZap[]} zaps
 * @returns {Map<string, {totalMsats: number, count: number}>}
 */
export function tallyZaps(zaps) {
  const seenProofs = new Set();
  const byTarget = new Map();
  for (const zap of zaps) {
    if (seenProofs.has(zap.proof)) continue;
    seenProofs.add(zap.proof);
    const entry = byTarget.get(zap.target) ?? { totalMsats: 0, count: 0 };
    entry.totalMsats += zap.msats;
    entry.count += 1;
    byTarget.set(zap.target, entry);
  }
  return byTarget;
}
