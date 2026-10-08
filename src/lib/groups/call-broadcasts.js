// Call broadcasts — kind 20002 (docs/nips/nip29-ephemeral-groups.md, "Call
// broadcasts"): a host tells every breakout room something at once. The
// rooms are separate LiveKit rooms, so a data message does not reach them,
// and a kind 9 would show up as chat for everyone; instead the host
// publishes an EPHEMERAL event to the group relay, addressed to the parent
// group, which clients in the parent's call and in every ephemeral child
// subscribe to for the duration of the session. The relay accepts it only
// from the parent's current call host / co-hosts or an admin, and never
// stores it. This file is the pure half (wire format, the countdown marks);
// breakout.svelte.js publishes, subscribes and renders.

/** NIP-01 ephemeral range: relayed to live subscribers, never stored. */
export const CALL_BROADCAST_KIND = 20002;
/** @typedef {'message' | 'countdown' | 'return'} CallBroadcastType */
/** @type {readonly CallBroadcastType[]} */
export const CALL_BROADCAST_TYPES = /** @type {const} */ (['message', 'countdown', 'return']);
/**
 * Seconds before `until` at which the host seat sends a `countdown`
 * (readers move their deadline display, they do not toast each one).
 */
export const COUNTDOWN_MARKS = /** @type {const} */ ([300, 120, 60]);

/**
 * @typedef {{
 *   id?: string,
 *   pubkey: string,
 *   parentId: string,
 *   type: CallBroadcastType,
 *   content: string,
 *   createdAt: number,
 *   seconds: number | null
 * }} CallBroadcast `seconds`: the `countdown`'s content as a number
 */

/**
 * The unsigned event template of a broadcast to the parent `parentId`.
 * @param {string} parentId
 * @param {CallBroadcastType} type
 * @param {string} [content]
 */
export function buildCallBroadcastTemplate(parentId, type, content = '') {
  if (!CALL_BROADCAST_TYPES.includes(type)) throw new RangeError(`unknown broadcast type ${type}`);
  return {
    kind: CALL_BROADCAST_KIND,
    content: String(content ?? ''),
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['h', parentId],
      ['type', type]
    ]
  };
}

/** The subscription a client in the parent's call or a child keeps. @param {string} parentId */
export function callBroadcastFilter(parentId) {
  return { kinds: [CALL_BROADCAST_KIND], '#h': [parentId] };
}

/**
 * Validate a kind-20002 event: exactly one `h` tag (the parent), a known
 * `type`, and for a countdown a non-negative whole number of seconds.
 * Anything else is dropped (`null`).
 * @param {unknown} event
 * @returns {CallBroadcast | null}
 */
export function parseCallBroadcast(event) {
  if (!event || typeof event !== 'object') return null;
  const e = /** @type {Record<string, unknown>} */ (event);
  if (e.kind !== CALL_BROADCAST_KIND || !Array.isArray(e.tags)) return null;
  if (typeof e.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(e.pubkey)) return null;
  const hTags = e.tags.filter((t) => Array.isArray(t) && t[0] === 'h');
  if (hTags.length !== 1 || typeof hTags[0][1] !== 'string' || !hTags[0][1]) return null;
  const type = e.tags.find((t) => Array.isArray(t) && t[0] === 'type')?.[1];
  if (!CALL_BROADCAST_TYPES.includes(/** @type {CallBroadcastType} */ (type))) return null;
  const content = typeof e.content === 'string' ? e.content : '';
  let seconds = null;
  if (type === 'countdown') {
    if (!/^\d+$/.test(content.trim())) return null;
    seconds = Number(content.trim());
  }
  return {
    ...(typeof e.id === 'string' ? { id: e.id } : {}),
    pubkey: e.pubkey.toLowerCase(),
    parentId: hTags[0][1],
    type: /** @type {CallBroadcastType} */ (type),
    content,
    createdAt: typeof e.created_at === 'number' ? e.created_at : 0,
    seconds
  };
}

/**
 * Which countdown mark is due at `remaining` seconds, given the marks
 * already sent. A mark counts as due once `remaining` has dropped to it;
 * when several are due at once (a host seat that took over late, a clock
 * that skipped) only the tightest is sent and the rest are marked sent, so
 * nobody gets "5 minutes" right after "2 minutes". Marks above `remaining`
 * are forgotten again, so a moved deadline fires them anew.
 * @param {number} remaining whole seconds left
 * @param {ReadonlySet<number>} sent
 * @returns {{mark: number | null, sent: Set<number>}}
 */
export function countdownDue(remaining, sent) {
  const next = new Set([...sent].filter((mark) => remaining <= mark));
  if (remaining <= 0) return { mark: null, sent: next };
  const due = COUNTDOWN_MARKS.filter((mark) => remaining <= mark && !next.has(mark));
  if (due.length === 0) return { mark: null, sent: next };
  for (const mark of due) next.add(mark);
  return { mark: Math.min(...due), sent: next };
}
