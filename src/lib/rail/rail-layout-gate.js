// Whether the rail's arrangement may leave this device.
//
// Its own module, deliberately: two data-loss chains terminate on this one
// decision, and both are closed by it answering false.
//
//   a decrypt failure read as an empty layout → normalizeLayout gives the
//   default order → that order is published over the user's good event → the
//   arrangement is gone on every device
//
//   a signer that cannot NIP-44 → encryption "fails soft" → the same layout
//   goes out in the clear → which private Concord areas and NIP-29 groups the
//   user holds is now public, which is the disclosure the whole feature exists
//   to prevent
//
// So it is a WHITELIST. A status has to be named to be allowed; a status added
// later and left unclassified is refused, not admitted. The inbox precedent
// this feature was modelled on has no gate at all, and its bare catch reaches
// the plaintext branch on any signer hiccup — that is the shape being avoided.

/**
 * What is known about the remote copy of the layout.
 *
 * `locked` and `absent` are the pair that must never collapse into each other:
 * "an event exists that I could not read" and "no event exists" look the same
 * from a failed read, and treating the first as the second is what overwrites
 * a user's arrangement with a default.
 *
 * @satisfies {Record<string, string>}
 */
export const RAIL_SYNC_STATUS = /** @type {const} */ ({
  /** Sync has not been started for any account. */
  idle: 'idle',
  /** Subscribed; no relay has answered yet. Says nothing about what is stored. */
  loading: 'loading',
  /** The relays answered and hold no layout for this account. */
  absent: 'absent',
  /** A layout event arrived and was decrypted. */
  loaded: 'loaded',
  /** A layout event arrived and could NOT be decrypted. Not the same as absent. */
  locked: 'locked',
  /** This signer cannot NIP-44, so the rail does not sync. It does not sync in the clear. */
  unavailable: 'unavailable'
});

/** @typedef {(typeof RAIL_SYNC_STATUS)[keyof typeof RAIL_SYNC_STATUS]} RailSyncStatus */

/**
 * The states in which the remote is known well enough to replace it.
 * Written out rather than derived so the allowed set is reviewable in one line.
 * @type {string[]}
 */
const PUBLISHABLE = [RAIL_SYNC_STATUS.loaded, RAIL_SYNC_STATUS.absent];

/**
 * Whether an edit made now may be published.
 *
 * @param {RailSyncStatus | string | null | undefined} status
 * @returns {boolean}
 */
export function canPublishRailLayout(status) {
  return typeof status === 'string' && PUBLISHABLE.includes(status);
}

/**
 * Whether the remote state is settled — i.e. whether the UI may present the
 * rail as synced rather than still resolving.
 *
 * The same set as PUBLISHABLE today, but a different question, and they are
 * kept apart on purpose: "I know what the remote holds" and "I may overwrite
 * it" are only accidentally the same, and a future read-only state would
 * separate them.
 *
 * @param {RailSyncStatus | string | null | undefined} status
 * @returns {boolean}
 */
export function isRailLayoutLoaded(status) {
  return status === RAIL_SYNC_STATUS.loaded || status === RAIL_SYNC_STATUS.absent;
}
