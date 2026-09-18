// Pure helpers for the rumors inside NIP-17 gift wraps.
//
// applesauce's getConversationParticipants() throws for any kind but 4 and 14,
// and its WrappedMessagesModel keeps kind 14 only — so file messages (15) and
// private reactions (7) were unwrapped and then silently dropped (laoc,
// 2026-09-18; Amethyst and dark-wisp both render them). Identity maths here
// must stay byte-compatible with createConversationIdentifier: unique, sorted,
// ':'-joined.
//
// EVERY function in this module is TOTAL. A rumor is unsigned JSON decrypted
// out of a kind-1059 gift wrap: `content` may be a number or an object, `tags`
// may be absent or hold non-array entries, `pubkey`/`id` may be missing. The
// DM inbox item renders OUTSIDE the route-level <svelte:boundary>, so a single
// throw here blanks the whole app on every route — and the wrap is cached, so
// it stays blank. Guard, never throw.
import { kinds } from 'nostr-tools';

/** Rumor kinds that are MESSAGES in a thread (chat text, encrypted file). */
export const DM_MESSAGE_KINDS = [kinds.PrivateDirectMessage, kinds.FileMessage];

/**
 * A rumor-shaped value: a non-null, non-array object. Anything else (null,
 * undefined, a string, a number, an array) is not worth inspecting.
 * @param {unknown} rumor
 * @returns {rumor is Record<string, any>}
 */
function isRumorObject(rumor) {
  return !!rumor && typeof rumor === 'object' && !Array.isArray(rumor);
}

/**
 * The rumor's kind, or null when it is missing or not a number.
 * @param {unknown} rumor
 * @returns {number | null}
 */
function rumorKind(rumor) {
  if (!isRumorObject(rumor)) return null;
  return typeof rumor.kind === 'number' ? rumor.kind : null;
}

/**
 * Well-formed tags only: an array of arrays whose first two entries are
 * strings. Returns [] for anything else.
 * @param {unknown} rumor
 * @returns {string[][]}
 */
function rumorTags(rumor) {
  if (!isRumorObject(rumor)) return [];
  const tags = rumor.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (t) => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string'
  );
}

/**
 * The rumor's content as a string — '' when it is absent or not a string
 * (a number, an object, null: all attacker-reachable).
 * @param {unknown} rumor
 * @returns {string}
 */
export function rumorContent(rumor) {
  if (!isRumorObject(rumor)) return '';
  return typeof rumor.content === 'string' ? rumor.content : '';
}

/** @param {unknown} rumor */
export function isDmMessageRumor(rumor) {
  const kind = rumorKind(rumor);
  return kind !== null && DM_MESSAGE_KINDS.includes(kind);
}
/** @param {unknown} rumor */
export function isDmFileRumor(rumor) {
  return rumorKind(rumor) === kinds.FileMessage;
}
/** @param {unknown} rumor */
export function isDmReactionRumor(rumor) {
  return rumorKind(rumor) === kinds.Reaction;
}

/**
 * Author + every p tag, deduped and order-preserving.
 * @param {unknown} rumor
 * @returns {string[]}
 */
export function rumorParticipants(rumor) {
  /** @type {string[]} */
  const out = [];
  if (isRumorObject(rumor) && typeof rumor.pubkey === 'string' && rumor.pubkey) {
    out.push(rumor.pubkey);
  }
  for (const tag of rumorTags(rumor)) {
    if (tag[0] === 'p' && tag[1]) out.push(tag[1]);
  }
  return [...new Set(out)];
}

/**
 * @param {unknown} rumor
 * @returns {string}
 */
export function rumorConversationId(rumor) {
  return rumorParticipants(rumor).sort().join(':');
}

/**
 * @param {unknown} rumor
 * @param {string} name
 * @returns {string | null}
 */
const tag = (rumor, name) => rumorTags(rumor).find((t) => t[0] === name && t[1])?.[1] ?? null;

/**
 * NIP-17 encrypted file header (kind 15): the url is the content, the AES-GCM
 * material and the metadata are tags. Returns null unless url + algorithm +
 * key + nonce are all present and the url is http(s).
 * @param {unknown} rumor
 */
export function parseFileRumor(rumor) {
  if (!isDmFileRumor(rumor)) return null;
  const url = rumorContent(rumor).trim();
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
    blurhash: tag(rumor, 'blurhash'),
    alt: tag(rumor, 'alt')
  };
}

/**
 * @param {unknown} rumor
 * @returns {string | null}
 */
export function reactionTargetId(rumor) {
  return tag(rumor, 'e');
}

/**
 * NIP-25 says a reaction content of `+` (or empty) is a like and `-` a
 * dislike — clients render them as emoji, they are not meant to be shown
 * literally. Everything else (a real emoji, a NIP-30 `:shortcode:`) passes
 * through untouched.
 * @param {unknown} rumor
 * @returns {string}
 */
export function reactionDisplayContent(rumor) {
  const content = rumorContent(rumor).trim();
  if (content === '' || content === '+') return '👍';
  if (content === '-') return '👎';
  return content;
}
