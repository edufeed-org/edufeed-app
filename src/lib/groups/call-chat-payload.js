// The call chat's wire format. Pure.
//
// Call chat messages are LiveKit data messages (reliable, topic
// `edufeed.call.chat`, see livekit-connection.svelte.js and
// docs/nips/nip29-call-passes.md "In-call chat"). This module is the one
// place that says what a payload may carry: `livekit-connection` only
// moves bytes, the panel only renders what `parseCallChatPayload` kept.
//
// Compatibility: `id` is new. A peer that still sends `{t, text, n, ts}`
// renders exactly as before — the receiver keys such a message by
// `<identity>:<n>` — and a peer that ignores `id` keeps deduping on
// `(identity, n)`, which stays unique because `n` is derived from `id`.
import { normalizeCustomEmoji } from './call-reactions.js';

/**
 * @typedef {Object} CallChatPayload
 * @property {'chat'} t
 * @property {string} [id] client-generated v4 uuid; what replies point at.
 *   Absent from messages of older clients.
 * @property {string} text ≤ CALL_CHAT_MAX_CHARS, trimmed
 * @property {string} n nonce ≤ 32 chars (legacy dedupe key; `nonceFor(id)`)
 * @property {number} [ts] the sender's send time (unix ms) — only on a
 *   history replay to a late joiner
 * @property {Array<[shortcode: string, url: string]>} [emoji] NIP-30 custom
 *   emojis the text references as `:shortcode:` (https image URLs)
 * @property {string} [replyTo] `id` of the message this one replies to
 * @property {{ n: string, text: string }} [replyPreview] the replied-to
 *   message as the sender saw it — author name (`n`, ≤ 64) and first line
 *   (≤ 200) — so the quote shows even when the original never reached the
 *   receiver
 * @property {string[]} [mentions] identities of mentioned participants;
 *   `"*"` means everyone in the call
 * @property {string} [to] recipient identity of a private message (sent
 *   with `destinationIdentities: [to]`; a receiver drops a `to` that is
 *   not itself)
 */

/**
 * @typedef {Object} CallChatParsed what a receiver keeps of a payload:
 *   the validated optional fields of {@link CallChatPayload}, minus `t`
 * @property {string} [id]
 * @property {string} text
 * @property {string} n
 * @property {number} [ts]
 * @property {Array<[string, string]>} [emoji]
 * @property {string} [replyTo]
 * @property {{ n: string, text: string }} [replyPreview]
 * @property {string[]} [mentions]
 * @property {string} [to]
 */

export const CALL_CHAT_MAX_CHARS = 2000;
const NONCE_MAX = 32;
const EMOJI_MAX = 20;
const MENTIONS_MAX = 64;
const IDENTITY_MAX = 128;
const PREVIEW_NAME_MAX = 64;
const PREVIEW_TEXT_MAX = 200;
// A v4 uuid, or any other opaque id of the same spirit (letters, digits,
// `-`/`_`, 8–36 chars) — the id is a lookup key, never interpreted.
const ID_RE = /^[A-Za-z0-9_-]{8,36}$/;

/** A fresh message id. */
export function newCallChatId() {
  const c = /** @type {any} */ (globalThis.crypto);
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  // Fallback for contexts without randomUUID (old WebViews): still v4-shaped.
  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The legacy nonce for an id: the id without dashes, cut to 32 chars —
 * unique whenever the id is, and what older receivers dedupe on.
 * @param {string} id
 */
export function nonceFor(id) {
  return id.replace(/-/g, '').slice(0, NONCE_MAX);
}

/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
/** @param {unknown} v */
const isIdentity = (v) => typeof v === 'string' && v.length > 0 && v.length <= IDENTITY_MAX;

/**
 * Validate a received payload. Unknown fields are ignored, malformed
 * optional fields are dropped (the message itself is kept), a malformed
 * required field rejects the whole message.
 * @param {unknown} raw
 * @returns {CallChatParsed | null}
 */
export function parseCallChatPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = /** @type {Record<string, unknown>} */ (raw);
  if (p.t !== 'chat') return null;
  if (typeof p.text !== 'string' || p.text.length > CALL_CHAT_MAX_CHARS) return null;
  const text = p.text.trim();
  if (!text) return null;
  if (typeof p.n !== 'string' || p.n.length === 0 || p.n.length > NONCE_MAX) return null;

  /** @type {CallChatParsed} */
  const out = { text, n: p.n };
  if (isId(p.id)) out.id = /** @type {string} */ (p.id);
  if (typeof p.ts === 'number' && Number.isFinite(p.ts)) out.ts = p.ts;

  if (Array.isArray(p.emoji)) {
    /** @type {Map<string, string>} */
    const seen = new Map();
    for (const pair of p.emoji) {
      if (seen.size >= EMOJI_MAX) break;
      if (!Array.isArray(pair)) continue;
      const custom = normalizeCustomEmoji({ shortcode: pair[0], url: pair[1] });
      if (custom && !seen.has(custom.shortcode)) seen.set(custom.shortcode, custom.url);
    }
    if (seen.size > 0) out.emoji = [...seen.entries()];
  }

  if (isId(p.replyTo)) out.replyTo = /** @type {string} */ (p.replyTo);
  if (p.replyPreview && typeof p.replyPreview === 'object') {
    const { n, text: quoted } = /** @type {{ n?: unknown, text?: unknown }} */ (p.replyPreview);
    if (typeof n === 'string' && typeof quoted === 'string') {
      const firstLine = quoted
        .split(/\r\n|\r|\n/)[0]
        .trim()
        .slice(0, PREVIEW_TEXT_MAX);
      if (firstLine) {
        out.replyPreview = {
          n: n.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_NAME_MAX),
          text: firstLine
        };
      }
    }
  }

  if (Array.isArray(p.mentions)) {
    const mentions = [...new Set(p.mentions.filter((m) => m === '*' || isIdentity(m)))].slice(
      0,
      MENTIONS_MAX
    );
    if (mentions.length > 0) out.mentions = /** @type {string[]} */ (mentions);
  }

  if (isIdentity(p.to)) out.to = /** @type {string} */ (p.to);
  return out;
}

/**
 * The wire shape of a kept message — for a live send and for the history
 * replay to a late joiner (`ts: true` adds the original send time).
 * @param {{ id: string, n: string, text: string, at: number, emoji?: Array<[string, string]>,
 *   replyTo?: string, replyPreview?: { n: string, text: string }, mentions?: string[], to?: string }} record
 * @param {{ ts?: boolean }} [opts]
 * @returns {CallChatPayload}
 */
export function toCallChatPayload(record, { ts = false } = {}) {
  /** @type {CallChatPayload} */
  const payload = { t: 'chat', text: record.text, n: record.n };
  // A legacy local key (`<identity>:<n>`) is not an id anyone else knows.
  if (isId(record.id)) payload.id = record.id;
  if (ts) payload.ts = record.at;
  if (record.emoji?.length) payload.emoji = record.emoji;
  if (record.replyTo) payload.replyTo = record.replyTo;
  if (record.replyPreview) payload.replyPreview = record.replyPreview;
  if (record.mentions?.length) payload.mentions = record.mentions;
  if (record.to) payload.to = record.to;
  return payload;
}
