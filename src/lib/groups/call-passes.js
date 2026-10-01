// NIP-29 AV call passes (docs/nips/nip29-call-passes.md) — the client half.
//
// A member mints a secret code, publishes only its sha256 (kind 9025, with
// the code NIP-44 self-encrypted so their other devices can rebuild the
// link), and hands out `/call/<pointer>#<code>`. The code lives in the URL
// FRAGMENT: it never reaches a server log or a Referer header. The holder's
// token request carries it in the signed NIP-98 event (livekit.js).
//
// Plain module (no runes): called from click handlers and tested in node.
import { livekitProbeUrl } from './livekit.js';
import { groupPointerString } from './groups.js';

export const CALL_PASS_KIND = 9025;
/** The relay rejects a call-scoped pass expiring later than this. */
export const CALL_SCOPE_TTL_S = 12 * 3600;

const CHECK_TIMEOUT_MS = 5000;
const CODE_RE = /^[A-Za-z0-9_-]{22,64}$/;
const REASONS = new Set(['ok', 'not_yet', 'expired', 'call_ended', 'unknown']);
const ZERO_HASH = '0'.repeat(64);

/** 16 random bytes, base64url without padding (22 chars, 128 bits). */
export function generatePassCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** @param {unknown} value */
export function isPassCode(value) {
  return typeof value === 'string' && CODE_RE.test(value);
}

/** @param {string} code @returns {Promise<string>} */
export async function hashPassCode(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Exactly one `h` tag: a relay resolves a group event by its first `h` but
 * matches `#h` against all of them.
 * @param {{groupId: string, codeHash: string, encryptedCode: string, expiration: number,
 *   notBefore?: number, scopeCall?: boolean, meeting?: [string, string]}} p
 */
export function buildCallPassTemplate({
  groupId,
  codeHash,
  encryptedCode,
  expiration,
  notBefore,
  scopeCall = false,
  meeting
}) {
  /** @type {string[][]} */
  const tags = [
    ['h', groupId],
    ['code-hash', codeHash],
    ['expiration', String(expiration)]
  ];
  if (notBefore) tags.push(['not-before', String(notBefore)]);
  if (scopeCall) tags.push(['scope', 'call']);
  if (meeting) tags.push(['a', meeting[0], meeting[1]]);
  return {
    kind: CALL_PASS_KIND,
    content: encryptedCode,
    created_at: Math.floor(Date.now() / 1000),
    tags
  };
}

/**
 * @param {string} origin e.g. location.origin
 * @param {{id: string, relay: string}} pointer
 * @param {string} code
 */
export function callLinkUrl(origin, pointer, code) {
  return `${origin}/call/${encodeURIComponent(groupPointerString(pointer))}#${code}`;
}

/** @param {string} hash location.hash, with or without the leading '#' */
export function readPassCodeFromHash(hash) {
  const value = String(hash ?? '').replace(/^#/, '');
  return isPassCode(value) ? value : null;
}

/** @param {string} relayUrl @param {string} groupId @param {string} codeHash */
export function passCheckUrl(relayUrl, groupId, codeHash) {
  const base = livekitProbeUrl(relayUrl);
  return base ? `${base}/${encodeURIComponent(groupId)}/pass/${codeHash}` : null;
}

/**
 * @typedef {{valid: boolean, reason: 'ok'|'not_yet'|'expired'|'call_ended'|'unknown'|'unreachable',
 *   notBefore?: number, expiration?: number, scope?: string, name?: string, picture?: string,
 *   liveCount: number}} PassCheck
 */

/** @param {string | null} url @returns {Promise<any | null>} JSON body, or null */
async function fetchJson(url) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The public pass check. Anything that is not the relay's JSON answer reads
 * as `unreachable`; an unrecognised reason never reads as valid.
 * @param {string} relayUrl @param {string} groupId @param {string} code
 * @returns {Promise<PassCheck>}
 */
export async function checkCallPass(relayUrl, groupId, code) {
  const json = await fetchJson(passCheckUrl(relayUrl, groupId, await hashPassCode(code)));
  if (!json || typeof json !== 'object')
    return { valid: false, reason: 'unreachable', liveCount: 0 };
  const reason = REASONS.has(json.reason) ? json.reason : 'unknown';
  /** @type {PassCheck} */
  const out = {
    valid: reason === 'ok' && json.valid === true,
    reason,
    liveCount: Number.isFinite(json.live_count) ? json.live_count : 0
  };
  if (Number.isFinite(json.not_before)) out.notBefore = json.not_before;
  if (Number.isFinite(json.expiration)) out.expiration = json.expiration;
  if (typeof json.scope === 'string') out.scope = json.scope;
  if (typeof json.name === 'string') out.name = json.name;
  if (typeof json.picture === 'string') out.picture = json.picture;
  return out;
}

/**
 * A relay supports call passes iff the pass check answers JSON for the
 * group (any hash). A stock relay, or a group without `livekit`, 404s.
 * @param {string} relayUrl @param {string} groupId
 */
export async function probeCallPassSupport(relayUrl, groupId) {
  const json = await fetchJson(passCheckUrl(relayUrl, groupId, ZERO_HASH));
  return !!json && typeof json === 'object' && typeof json.reason === 'string';
}
