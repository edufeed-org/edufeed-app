// The rail's arrangement as an encrypted app-data event — the pure half.
//
// Round 3 shipped the rail local-only on purpose: it names unlinked Concord
// AREAS and privately-held NIP-29 groups, so a plain event would announce which
// private rooms the user holds and how they filed them. laoc approved the
// encrypted version (2026-08-07), which is what this module addresses.
//
// Everything here is pure — no signer, no store, no relay. The service half
// (rail-layout-sync.svelte.js) owns the signer and the subscription; keeping
// the format and the conflict rule out here is what makes both testable
// without a relay, and it is why `normalizeLayout` never had to change.

/**
 * @typedef {import('./rail-layout.js').RailNode} RailNode
 * @typedef {{created_at: number, id: string}} LayoutEventStamp
 */

/** NIP-78 application data — the kind this app already uses for per-user
 * state, so no new relay support is needed. */
export const RAIL_LAYOUT_KIND = 30078;

/** Namespaced the way the app's other app-data d tags are. */
export const RAIL_LAYOUT_D_TAG = 'edufeed:rail-layout';

export const RAIL_LAYOUT_VERSION = 1;

/**
 * How far ahead of this device's clock a layout event may be dated.
 *
 * A bump exists at all so a device whose clock trails another does not lose
 * every edit (see nextLayoutCreatedAt). A BOUND exists because publishEvent
 * resolves rather than throwing when relays reject an event, so an event
 * future-dated past a relay's timestamp-delta policy would be dropped in
 * silence and read to the user as saved. A minute is far inside the usual
 * 15-minute window and far outside any honest race.
 */
export const MAX_FUTURE_SKEW = 60;

/**
 * The payload that gets encrypted.
 *
 * Deliberately a thin envelope around the layout rather than a re-serialisation
 * of it: a mapping step here is a place a folder can be silently dropped, and
 * the layout is already plain JSON. Untrusted junk is not filtered out either
 * — `normalizeLayout` is the single place stored order meets the live set, and
 * a second filter here would be a second answer to the same question.
 *
 * @param {RailNode[]} layout
 * @returns {{v: number, layout: RailNode[]}}
 */
export function encodeRailLayout(layout) {
  return { v: RAIL_LAYOUT_VERSION, layout };
}

/**
 * The layout carried by a decrypted payload, or null when there is none.
 *
 * null and `[]` are NOT interchangeable and this is the whole contract: `[]` is
 * a real layout meaning "default order", so answering `[]` for something
 * unreadable would show the user an unarranged rail AND invite a write that
 * replaces their good event with that default. Callers must treat null as "not
 * loaded" and keep the write path closed.
 *
 * @param {unknown} data
 * @returns {RailNode[] | null}
 */
export function decodeRailLayout(data) {
  if (!data || typeof data !== 'object') return null;
  const payload = /** @type {{v?: unknown, layout?: unknown}} */ (data);
  // An unknown version is unreadable, not empty. A future format that this
  // build cannot parse must not be treated as an arrangement to overwrite.
  if (payload.v !== RAIL_LAYOUT_VERSION) return null;
  if (!Array.isArray(payload.layout)) return null;
  return /** @type {RailNode[]} */ (payload.layout);
}

/**
 * Whether `candidate` supersedes `current`.
 *
 * This is NIP-01's own rule for replaceable events — later created_at wins,
 * ties go to the lower id — and matching it is the point rather than a detail.
 * A client that picked ties the other way would settle on a different event
 * than the relay serves, so two devices would disagree about which arrangement
 * is current while both were "correct".
 *
 * @param {LayoutEventStamp | null | undefined} candidate
 * @param {LayoutEventStamp | null | undefined} current
 * @returns {boolean}
 */
export function isNewerLayoutEvent(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at > current.created_at;
  }
  return candidate.id < current.id;
}

/**
 * The created_at a local edit must carry to actually win, or null when it
 * cannot win honestly.
 *
 * Without this, a device whose clock trails the other one writes an event the
 * relay treats as older and discards: the user drags something, it reverts a
 * moment later, and nothing anywhere reports an error. With an UNBOUNDED bump
 * the same fix mints events a relay drops for being too far ahead — equally
 * silent. So: step past the remote when that is within MAX_FUTURE_SKEW, and
 * otherwise refuse, leaving the caller to keep the edit locally and say that
 * sync is blocked.
 *
 * @param {number} now unix seconds
 * @param {number | null | undefined} remoteCreatedAt
 * @returns {number | null}
 */
export function nextLayoutCreatedAt(now, remoteCreatedAt) {
  if (typeof remoteCreatedAt !== 'number' || !Number.isFinite(remoteCreatedAt)) return now;
  if (remoteCreatedAt < now) return now;
  const bumped = remoteCreatedAt + 1;
  if (bumped > now + MAX_FUTURE_SKEW) return null;
  return bumped;
}
