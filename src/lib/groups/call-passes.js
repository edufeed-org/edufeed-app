// NIP-29 AV call passes (docs/nips/nip29-call-passes.md) — the client half.
//
// A member mints a secret code, publishes only its sha256 (kind 9025, with
// the code NIP-44 self-encrypted so their other devices can rebuild the
// link), and hands out `/call/<pointer>#<code>`. The code lives in the URL
// FRAGMENT: it never reaches a server log or a Referer header. The holder's
// token request carries it in the signed NIP-98 event (livekit.js).
//
// Plain module (no runes): called from click handlers and tested in node.
import { firstValueFrom, of } from 'rxjs';
import { catchError, toArray } from 'rxjs/operators';
import { livekitProbeUrl } from './livekit.js';
import { groupPointerString } from './groups.js';
import { publishToGroupRelay, buildDeleteEventTemplate } from './group-management.js';
import { authenticateOnce } from './relay-auth.js';
import { hasNip44 } from '$lib/helpers/nip44.js';

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

const LIST_TIMEOUT_MS = 5000;

/**
 * Mint an ad-hoc link for the running call: valid until the call ends (the
 * relay deletes call-scoped passes then), 12 h at most.
 * @param {any} relayConn pool.relay(pointer.relay)
 * @param {{id: string, relay: string}} pointer
 * @param {{pubkey: string, signer: any}} user
 * @param {string} origin
 */
export async function createCallLink(relayConn, pointer, user, origin) {
  if (!hasNip44(user.signer)) throw new Error('nip44-unsupported');
  const code = generatePassCode();
  const template = buildCallPassTemplate({
    groupId: pointer.id,
    codeHash: await hashPassCode(code),
    encryptedCode: await user.signer.nip44.encrypt(user.pubkey, code),
    expiration: Math.floor(Date.now() / 1000) + CALL_SCOPE_TTL_S,
    scopeCall: true
  });
  const event = await publishToGroupRelay(relayConn, template, user);
  return { code, url: callLinkUrl(origin, pointer, code), event };
}

/** @param {any} event */
function expirationOf(event) {
  const raw = event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'expiration')?.[1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Passes of this channel the relay lets me see (my own; all of them for a
 * moderator). The relay hides 9025 from unauthenticated readers, so auth
 * comes first. Expired passes are dropped client-side as a courtesy — the
 * relay is expected to delete them, but a slow sweep must not surface a
 * dead link.
 * @param {any} relayConn @param {string} groupId @param {{pubkey: string, signer: any}} user
 */
export async function listCallPasses(relayConn, groupId, user) {
  await authenticateOnce(relayConn, user.signer);
  const events = await firstValueFrom(
    relayConn
      .request({ kinds: [CALL_PASS_KIND], '#h': [groupId] }, { timeout: LIST_TIMEOUT_MS })
      .pipe(
        catchError(() => of()),
        toArray()
      )
  );
  const now = Math.floor(Date.now() / 1000);
  const byId = new Map();
  for (const e of /** @type {any[]} */ (events)) {
    if (e?.kind === CALL_PASS_KIND && expirationOf(e) > now) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * The link of one of MY passes (the content is the code, self-encrypted).
 * @param {any} pass @param {{pubkey: string, signer: any}} user
 * @param {{id: string, relay: string}} pointer @param {string} origin
 */
export async function passLinkFor(pass, user, pointer, origin) {
  if (pass?.pubkey !== user.pubkey || !hasNip44(user.signer)) return null;
  try {
    const code = await user.signer.nip44.decrypt(user.pubkey, pass.content);
    return isPassCode(code) ? callLinkUrl(origin, pointer, code) : null;
  } catch {
    return null;
  }
}

/**
 * Revoke: the relay deletes the pass and removes everyone who joined with
 * it. The author signs a NIP-09 kind 5; a moderator revoking someone else's
 * pass signs a NIP-29 kind 9005. publishToGroupRelay answers the relay's
 * auth-required rejection (the relay demands NIP-42 auth for this).
 * @param {any} relayConn @param {any} pass @param {{pubkey: string, signer: any}} user
 * @param {{asAdmin?: boolean}} [opts]
 */
export async function revokeCallPass(relayConn, pass, user, { asAdmin = false } = {}) {
  const groupId = pass?.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
  if (!groupId) throw new Error('pass without h tag');
  if (pass.pubkey === user.pubkey) {
    await publishToGroupRelay(
      relayConn,
      {
        kind: 5,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', pass.id],
          ['h', groupId],
          ['k', String(CALL_PASS_KIND)]
        ]
      },
      user
    );
    return;
  }
  if (!asAdmin) throw new Error('only the author or a moderator can revoke this link');
  await publishToGroupRelay(relayConn, buildDeleteEventTemplate(groupId, pass.id), user);
}
