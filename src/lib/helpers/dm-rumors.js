// Pure helpers for the rumors inside NIP-17 gift wraps.
//
// applesauce's getConversationParticipants() throws for any kind but 4 and 14,
// and its WrappedMessagesModel keeps kind 14 only — so file messages (15) and
// private reactions (7) were unwrapped and then silently dropped (laoc,
// 2026-09-18; Amethyst and dark-wisp both render them). Identity maths here
// must stay byte-compatible with createConversationIdentifier: unique, sorted,
// ':'-joined.
import { kinds } from 'nostr-tools';

/** Rumor kinds that are MESSAGES in a thread (chat text, encrypted file). */
export const DM_MESSAGE_KINDS = [kinds.PrivateDirectMessage, kinds.FileMessage];

/** @param {{kind?: number} | null | undefined} rumor */
export function isDmMessageRumor(rumor) {
  return !!rumor && DM_MESSAGE_KINDS.includes(rumor.kind ?? -1);
}
/** @param {{kind?: number} | null | undefined} rumor */
export function isDmFileRumor(rumor) {
  return rumor?.kind === kinds.FileMessage;
}
/** @param {{kind?: number} | null | undefined} rumor */
export function isDmReactionRumor(rumor) {
  return rumor?.kind === kinds.Reaction;
}

/**
 * Author + every p tag, deduped and order-preserving.
 * @param {{pubkey?: string, tags?: string[][]} | null | undefined} rumor
 * @returns {string[]}
 */
export function rumorParticipants(rumor) {
  const out = [];
  if (rumor?.pubkey) out.push(rumor.pubkey);
  for (const tag of rumor?.tags ?? []) {
    if (tag[0] === 'p' && tag[1]) out.push(tag[1]);
  }
  return [...new Set(out)];
}

/** @param {any} rumor */
export function rumorConversationId(rumor) {
  return rumorParticipants(rumor).sort().join(':');
}

/** @param {any} rumor @param {string} name */
const tag = (rumor, name) =>
  rumor?.tags?.find((/** @type {string[]} */ t) => t[0] === name && t[1])?.[1] ?? null;

/**
 * NIP-17 encrypted file header (kind 15): the url is the content, the AES-GCM
 * material and the metadata are tags. Returns null unless url + algorithm +
 * key + nonce are all present and the url is http(s).
 * @param {any} rumor
 */
export function parseFileRumor(rumor) {
  if (!isDmFileRumor(rumor)) return null;
  const url = (rumor.content ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const algorithm = tag(rumor, 'encryption-algorithm');
  const key = tag(rumor, 'decryption-key');
  const nonce = tag(rumor, 'decryption-nonce');
  if (!algorithm || !key || !nonce) return null;
  const size = Number(tag(rumor, 'size'));
  return {
    url,
    mimeType: tag(rumor, 'file-type'),
    algorithm,
    key,
    nonce,
    hash: tag(rumor, 'x'),
    size: Number.isFinite(size) && size > 0 ? size : null,
    dim: tag(rumor, 'dim'),
    blurhash: tag(rumor, 'blurhash')
  };
}

/** @param {any} rumor */
export function reactionTargetId(rumor) {
  return tag(rumor, 'e');
}
