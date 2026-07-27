/**
 * Cordn spec/02 — Nostr-shaped message envelopes carried inside MLS
 * application messages. Envelopes are intentionally unsigned: authorship is
 * established by MLS sender authentication, and the envelope `pubkey` must
 * equal the authenticated sender's stable identity.
 */
import { getEventHash } from 'nostr-tools/pure';

/** Chat message kind (NIP-C7 convention, reused per spec/02 §6). */
export const CORDN_CHAT_KIND = 9;

/**
 * Build an unsigned Cordn envelope with a NIP-01-derived id.
 *
 * @param {object} params
 * @param {string} params.pubkey - sender's stable hex pubkey (MLS credential identity)
 * @param {string} params.content
 * @param {number} [params.kind]
 * @param {string[][]} [params.tags]
 * @param {number} [params.created_at] - unix seconds; defaults to now
 * @returns {{id: string, pubkey: string, created_at: number, kind: number, tags: string[][], content: string}}
 */
export function buildEnvelope({
  pubkey,
  content,
  kind = CORDN_CHAT_KIND,
  tags = [],
  created_at = Math.floor(Date.now() / 1000)
}) {
  const envelope = { pubkey, created_at, kind, tags, content };
  return { id: getEventHash(envelope), ...envelope };
}

const REQUIRED_FIELDS = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content'];

/**
 * Validate a received envelope per spec/02 §4 (id recomputation) and §5
 * (pubkey must equal the authenticated MLS sender identity).
 *
 * @param {Record<string, unknown>} envelope
 * @param {string} senderPubkey - authenticated MLS sender identity
 * @returns {{valid: true} | {valid: false, reason: string}}
 */
export function validateEnvelope(envelope, senderPubkey) {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, reason: 'envelope is not an object' };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in envelope)) return { valid: false, reason: `missing field ${field}` };
  }
  if ('sig' in envelope) return { valid: false, reason: 'envelope must not carry a sig field' };
  if (envelope.pubkey !== senderPubkey) {
    return { valid: false, reason: 'pubkey does not match authenticated MLS sender' };
  }
  const expectedId = getEventHash(/** @type {import('nostr-tools').UnsignedEvent} */ (envelope));
  if (envelope.id !== expectedId) {
    return { valid: false, reason: 'id does not match NIP-01 serialization' };
  }
  return { valid: true };
}
