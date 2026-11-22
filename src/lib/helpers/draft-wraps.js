/**
 * NIP-37 draft wraps: an unsigned event template, NIP-44-encrypted to its
 * author, as a replaceable kind 31234 (`d` = the draft's address, `k` = its
 * kind). Nothing readable reaches a relay; the same `d` replaces the wrap.
 * Pure, no I/O beyond the signer's nip44.
 */
import { hasNip44 } from '$lib/helpers/nip44.js';

export const DRAFT_WRAP_KIND = 31234;

/** @param {any} event @param {string} name */
const tagOf = (event, name) =>
  (Array.isArray(event?.tags) ? event.tags : []).find(
    (/** @type {any} */ t) => Array.isArray(t) && t[0] === name
  )?.[1];

/**
 * @param {{ kind: number, created_at?: number, tags: string[][], content: string }} draft an unsigned template
 * @param {any} signer with `nip44.encrypt` @param {string} pubkey the author (encrypted to self)
 * @returns {Promise<import('nostr-tools').EventTemplate>}
 */
export async function wrapDraftTemplate(draft, signer, pubkey) {
  const dTag = tagOf(draft, 'd');
  if (!dTag) throw new Error('draft has no d tag');
  const content = await signer.nip44.encrypt(pubkey, JSON.stringify(draft));
  // never publish plaintext, whatever the signer handed back
  if (!content || content.startsWith('{')) throw new Error('nip44 encrypt returned no ciphertext');
  return {
    kind: DRAFT_WRAP_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', dTag],
      ['k', String(draft.kind)]
    ],
    content
  };
}

/**
 * A wrap → its draft template; null when it is no wrap, has no `d`, cannot be
 * decrypted or parsed, or its draft's kind is not the `k` tag. Never throws.
 * @param {any} event @param {any} signer @param {string} pubkey
 * @returns {Promise<{ kind: number, created_at?: number, tags: string[][], content: string } | null>}
 */
export async function unwrapDraft(event, signer, pubkey) {
  if (event?.kind !== DRAFT_WRAP_KIND || !tagOf(event, 'd') || !hasNip44(signer)) return null;
  try {
    const draft = JSON.parse(await signer.nip44.decrypt(pubkey, event.content));
    if (
      typeof draft?.kind !== 'number' ||
      String(draft.kind) !== tagOf(event, 'k') ||
      typeof draft.content !== 'string' ||
      !Array.isArray(draft.tags)
    )
      return null;
    return draft;
  } catch {
    return null;
  }
}
