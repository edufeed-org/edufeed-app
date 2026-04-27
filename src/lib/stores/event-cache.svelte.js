/**
 * Persistent event cache backed by nostr-idb (IndexedDB).
 *
 * Phase 1 goal: make repeat visits paint cached profiles, relay lists,
 * calendars, and educational resources instantly. See the spec at
 * docs/superpowers/specs/2026-04-24-persistent-event-cache-design.md
 *
 * The cache is ADDITIVE — if IDB fails to open or read, the app degrades
 * gracefully to network-only behavior (console.warn, no user-visible error).
 */

/**
 * Kinds we persist to IDB. See spec §"What gets persisted" for rationale.
 * Write filter applied inside persistEventsToCache's writer callback.
 */
const CACHEABLE_KINDS = new Set([
  0, // profiles
  3, // contact lists
  5, // NIP-09 deletions (required for correctness)
  10002, // NIP-65 relay lists
  10222, // community definitions
  30000, // follow sets (d=communities et al)
  30002, // app relay overrides
  30023, // long-form articles
  30142, // AMB educational resources
  31922, // date-based calendar events
  31923, // time-based calendar events
  31924 // calendars
]);

/**
 * @param {number} kind
 * @returns {boolean}
 */
export function isCacheableKind(kind) {
  return CACHEABLE_KINDS.has(kind);
}
