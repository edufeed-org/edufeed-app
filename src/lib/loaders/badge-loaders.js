/**
 * Badge Loaders - Following applesauce loader pattern
 *
 * These loaders are used to fetch badge-related events from relays.
 * Following the pattern from the badger app.
 *
 * Timeline Loaders (this file):
 * - Kind 30009: Badge Definitions - discover badges created by user
 * - Kind 8: Badge Awards - discover awards received/given
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';

/**
 * Badge definition loader - loads badges created by user (kind 30009)
 * Used to populate badge selector dropdowns in community settings
 *
 * @param {any} pool - Nostr relay pool
 * @param {string[]} defaultRelays - Array of relay URLs
 * @param {any} eventStore - EventStore instance
 * @param {string} authorPubkey - Author's pubkey whose badges to fetch
 * @returns {Function} Factory function that returns loader function
 */
export function createBadgeDefinitionLoader(pool, defaultRelays, eventStore, authorPubkey) {
  return () =>
    createTimelineLoader(
      pool,
      defaultRelays,
      { kinds: [30009], authors: [authorPubkey], limit: 200 },
      { eventStore }
    );
}

/**
 * Badge award loader - loads awards for a specific badge (kind 8)
 * Used to check if users hold a specific badge
 *
 * @param {any} pool - Nostr relay pool
 * @param {string[]} relays - Array of relay URLs (use naddr relay hints if available)
 * @param {any} eventStore - EventStore instance
 * @param {string} badgeAddress - Badge address in format "30009:pubkey:identifier"
 * @returns {Function} Factory function that returns loader function
 */
export function createBadgeAwardLoader(pool, relays, eventStore, badgeAddress) {
  return () =>
    createTimelineLoader(
      pool,
      relays,
      { kinds: [8], '#a': [badgeAddress], limit: 200 },
      { eventStore }
    );
}

/**
 * Awards given loader - loads badge awards created by user (kind 8)
 * Used to see what badges a user has awarded to others
 *
 * @param {any} pool - Nostr relay pool
 * @param {string[]} defaultRelays - Array of relay URLs
 * @param {any} eventStore - EventStore instance
 * @param {string} issuerPubkey - Issuer's pubkey whose awards to fetch
 * @returns {Function} Factory function that returns loader function
 */
export function createAwardsGivenLoader(pool, defaultRelays, eventStore, issuerPubkey) {
  return () =>
    createTimelineLoader(
      pool,
      defaultRelays,
      { kinds: [8], authors: [issuerPubkey], limit: 200 },
      { eventStore }
    );
}
