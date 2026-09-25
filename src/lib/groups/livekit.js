// NIP-29 live audio/video (AV) transport — the client half of the spec's
// "Live audio/video (AV) spaces" section, as implemented by pyramid:
//
//   - a group supports AV when its kind-39000 carries a bare `livekit` tag;
//   - the relay advertises AV support with HTTP 204 on
//     `<origin>/.well-known/nip29/livekit`;
//   - a LiveKit JWT is minted at `<origin>/.well-known/nip29/livekit/<group-id>`
//     for a NIP-98 (kind 27235) GET whose `u` tag equals that exact URL; the
//     JSON answer is `{server_url, participant_token}` (LiveKit's standard
//     TokenSourceResponse shape);
//   - the JWT identity starts with the user's 64-hex pubkey followed by a
//     random suffix (one user may sit in the room several times), so a
//     participant's pubkey is `identity.slice(0, 64)`.
//
// Presence (kind 39004) lives in call-presence.js; this module is plain (no
// runes) so it can be called from click handlers and tested in node.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';

const PROBE_TIMEOUT_MS = 5000;
const TOKEN_TIMEOUT_MS = 10000;

/**
 * The http(s) ORIGIN a group relay's `.well-known` endpoints hang off. A
 * community pointer relay carries a `/c/<rootId>` path
 * (community-endpoint.js); the spec's paths are relay-wide, so only the
 * origin survives. Null for anything that is not a ws(s) URL.
 * @param {string} relayUrl
 * @returns {string | null}
 */
export function relayHttpOrigin(relayUrl) {
  if (typeof relayUrl !== 'string' || !relayUrl.trim()) return null;
  let parsed;
  try {
    parsed = new URL(normalizeURL(relayUrl));
  } catch {
    return null;
  }
  const scheme = parsed.protocol === 'wss:' ? 'https:' : parsed.protocol === 'ws:' ? 'http:' : null;
  if (!scheme) return null;
  return `${scheme}//${parsed.host}`;
}

/** @param {string} relayUrl */
export function livekitProbeUrl(relayUrl) {
  const origin = relayHttpOrigin(relayUrl);
  return origin ? `${origin}/.well-known/nip29/livekit` : null;
}

/** @param {string} relayUrl @param {string} groupId */
export function livekitTokenUrl(relayUrl, groupId) {
  const base = livekitProbeUrl(relayUrl);
  return base ? `${base}/${encodeURIComponent(groupId)}` : null;
}

/**
 * Bare `livekit` tag on the RAW kind-39000 — same rule the settings sheet
 * uses for `hidden`/`private`/`closed` (applesauce's parsed metadata does
 * not surface it).
 * @param {{tags?: unknown} | null | undefined} metadataEvent
 */
export function hasLivekitTag(metadataEvent) {
  const tags = metadataEvent?.tags;
  return Array.isArray(tags) && tags.some((t) => Array.isArray(t) && t[0] === 'livekit');
}

/**
 * A LiveKit participant identity → the Nostr pubkey it was minted for, or
 * null when the identity does not start with 64 hex chars.
 * @param {unknown} identity
 * @returns {string | null}
 */
export function identityToPubkey(identity) {
  if (typeof identity !== 'string') return null;
  const head = identity.slice(0, 64);
  return /^[0-9a-f]{64}$/i.test(head) ? head.toLowerCase() : null;
}

/** @type {Map<string, Promise<boolean>>} */
const probeCache = new Map();

/** Test seam. */
export function __resetAvProbeCache() {
  probeCache.clear();
}

/**
 * Does this relay mint LiveKit tokens? True only on a 204. A negative answer
 * is NOT cached (same rule as relay-self.js: a relay mid-outage or not yet
 * configured must get a fresh chance on the next form open); in-flight
 * probes for one origin share a promise.
 * @param {string} relayUrl
 * @returns {Promise<boolean>}
 */
export function probeRelayAvSupport(relayUrl) {
  const url = livekitProbeUrl(relayUrl);
  if (!url) return Promise.resolve(false);
  const hit = probeCache.get(url);
  if (hit) return hit;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      return response.status === 204;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })().then((supported) => {
    if (!supported) probeCache.delete(url);
    return supported;
  });

  probeCache.set(url, promise);
  return promise;
}

/** @typedef {'unauthorized' | 'forbidden' | 'not-enabled' | 'server' | 'network'} GroupCallTokenReason */

export class GroupCallTokenError extends Error {
  /**
   * @param {GroupCallTokenReason} reason
   * @param {string} message
   * @param {number} [status]
   */
  constructor(reason, message, status) {
    super(message);
    this.name = 'GroupCallTokenError';
    this.reason = reason;
    this.status = status;
  }
}

/**
 * Ask the group relay for a LiveKit token. `user` is the same `{pubkey,
 * signer}` shape publishToGroupRelay takes. The NIP-98 event is signed
 * against the token URL itself (the relay compares its `u` tag to
 * `<scheme><domain>/.well-known/nip29/livekit/<id>` byte for byte).
 * @param {string} relayUrl
 * @param {string} groupId
 * @param {{pubkey: string, signer: {signEvent: (draft: any) => Promise<any>}}} user
 * @returns {Promise<{serverUrl: string, participantToken: string}>}
 */
export async function requestGroupCallToken(relayUrl, groupId, user) {
  const url = livekitTokenUrl(relayUrl, groupId);
  if (!url) throw new GroupCallTokenError('network', `not a relay url: ${relayUrl}`);

  const authorization = await createNIP98AuthHeader(url, 'GET', null, (draft) =>
    user.signer.signEvent({ ...draft, pubkey: user.pubkey })
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authorization },
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new GroupCallTokenError('network', err instanceof Error ? err.message : String(err));
  }
  clearTimeout(timer);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message = body.trim() || `relay answered ${response.status}`;
    /** @type {GroupCallTokenReason} */
    let reason = 'server';
    if (response.status === 401) reason = 'unauthorized';
    else if (response.status === 403)
      reason = /not enabled/i.test(body) ? 'not-enabled' : 'forbidden';
    throw new GroupCallTokenError(reason, message, response.status);
  }

  /** @type {any} */
  let json;
  try {
    json = await response.json();
  } catch {
    throw new GroupCallTokenError('server', 'relay answered with invalid JSON', response.status);
  }
  const serverUrl = json?.server_url;
  const participantToken = json?.participant_token;
  if (
    typeof serverUrl !== 'string' ||
    !serverUrl ||
    typeof participantToken !== 'string' ||
    !participantToken
  ) {
    throw new GroupCallTokenError(
      'server',
      'relay answered without server_url/participant_token',
      response.status
    );
  }
  return { serverUrl, participantToken };
}
