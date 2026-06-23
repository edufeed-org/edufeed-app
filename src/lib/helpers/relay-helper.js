/**
 * Relay Helper - Centralized relay retrieval with gated mode support
 *
 * All loaders should use this helper instead of directly accessing runtimeConfig.
 * This ensures gated mode is consistently applied across the application.
 *
 * When gated mode is active, fallback relays are excluded and only app-specific
 * relays are used for fetching content.
 */
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getInboxes, getOutboxes } from 'applesauce-core/helpers';

/**
 * Check if gated mode is currently active
 * @returns {boolean}
 */
export function isGatedModeActive() {
  return appSettings.gatedMode;
}

/**
 * Get fallback relays - returns empty array if gated mode is active
 * @returns {string[]}
 */
export function getFallbackRelays() {
  if (isGatedModeActive()) {
    return [];
  }
  return runtimeConfig.fallbackRelays || [];
}

/**
 * Get the default NIP-17 DM relay list a new user should publish (kind 10050).
 * Prefers configured DM_RELAYS; falls back to general fallback relays.
 * @returns {string[]}
 */
export function getDefaultDmRelays() {
  const configured = /** @type {string[] | undefined} */ (runtimeConfig.dmRelays);
  // Intentionally NOT gated: DM relays are the user's message inbox, not a
  // content source. getFallbackRelays() returns [] in gated mode, which would
  // hide the "no DM relay" nudge and leave the user unreachable. Read the raw
  // fallback list so a DM default always exists when DM_RELAYS is unset.
  return configured?.length ? configured : runtimeConfig.fallbackRelays || [];
}

/**
 * Get the default NIP-65 relay list a user should publish if they have none
 * (kind 10002). Intentionally NOT gated: a relay list is identity infrastructure
 * (where the user reads/writes their content), not a content source.
 * getFallbackRelays() returns [] in gated mode, which would leave new users with
 * no relay list at all, so read the raw fallback list.
 * @returns {string[]}
 */
export function getDefaultRelayList() {
  return runtimeConfig.fallbackRelays || [];
}

/**
 * True when a kind 10002 event advertises at least one inbox or outbox relay.
 * Used to treat an empty 10002 as "no relay list".
 *
 * NOTE: getInboxes/getOutboxes cache via a Symbol on the event, mutating it.
 * Never call this inside a $derived over reactive state — call it in a plain
 * subscription callback and store the boolean result in $state.
 * @param {any} event
 * @returns {boolean}
 */
export function hasMailboxRelays(event) {
  if (!event) return false;
  return getInboxes(event).length > 0 || getOutboxes(event).length > 0;
}

/**
 * Get calendar relays with optional fallback
 * @returns {string[]}
 */
export function getCalendarRelays() {
  const appRelays = getAppRelaysForCategory('calendar');
  return [...appRelays, ...getFallbackRelays()];
}

/**
 * Get communikey relays with optional fallback
 * @returns {string[]}
 */
export function getCommunikeyRelays() {
  const appRelays = getAppRelaysForCategory('communikey');
  return [...appRelays, ...getFallbackRelays()];
}

/**
 * Get educational (AMB) relays with optional fallback
 * @returns {string[]}
 */
export function getEducationalRelays() {
  const appRelays = getAppRelaysForCategory('educational');
  const combined = [...appRelays, ...getFallbackRelays()];
  return [...new Set(combined)]; // Deduplicate
}

/**
 * Get article/longform relays with optional fallback
 * @returns {string[]}
 */
export function getArticleRelays() {
  const appRelays = getAppRelaysForCategory('longform');
  // If no longform relays configured, use fallback relays only (but gated mode still applies)
  if (appRelays.length === 0) {
    return getFallbackRelays();
  }
  return [...appRelays, ...getFallbackRelays()];
}

/**
 * Get kanban board relays with optional fallback
 * @returns {string[]}
 */
export function getKanbanRelays() {
  const appRelays = getAppRelaysForCategory('kanban');
  if (appRelays.length === 0) {
    return getFallbackRelays();
  }
  return [...appRelays, ...getFallbackRelays()];
}

/**
 * Get all lookup relays for EventStore
 * Combines all app relays + conditional fallback
 * @returns {string[]}
 */
export function getAllLookupRelays() {
  return [
    ...getAppRelaysForCategory('calendar'),
    ...getAppRelaysForCategory('communikey'),
    ...getAppRelaysForCategory('educational'),
    ...getAppRelaysForCategory('longform'),
    ...getAppRelaysForCategory('kanban'),
    ...(runtimeConfig.fallbackRelays || [])
  ];
}

/**
 * Get the app-managed (durable) relays — every app category, no public fallback.
 *
 * Used to prioritize relay hints: among the relays an event was actually seen
 * on, these outlive transient public relays, so a hint pointing at one is more
 * likely to still resolve later. This intentionally omits fallbackRelays.
 * @returns {string[]}
 */
export function getAppManagedRelays() {
  return [
    ...new Set([
      ...getAppRelaysForCategory('calendar'),
      ...getAppRelaysForCategory('communikey'),
      ...getAppRelaysForCategory('educational'),
      ...getAppRelaysForCategory('longform'),
      ...getAppRelaysForCategory('kanban')
    ])
  ];
}

/**
 * Get lookup relays for the EventStore auto-load path (applesauce's
 * `lookupRelays` option on the unified/address loaders).
 *
 * This slot is applesauce's fallback-on-miss, intended for profile indexers
 * (e.g. `wss://purplepag.es`). Without indexer relays here, auto-loaded
 * profiles fetched via `eventStore.profile(pubkey)` / `useProfileMap`
 * never reach the indexer and silently fail to resolve when the author's
 * kind 0 isn't on one of the app content relays.
 *
 * @returns {string[]}
 */
export function getEventLoaderLookupRelays() {
  return [...(runtimeConfig.indexerRelays || []), ...getAllLookupRelays()];
}

/**
 * Get relays optimized for profile (kind 0) lookups.
 * Always includes indexer relays and relayListLookupRelays (even in gated mode)
 * since these provide identity resolution, not content.
 * @returns {string[]}
 */
export function getProfileLookupRelays() {
  const relays = [
    ...(runtimeConfig.indexerRelays || []),
    ...(runtimeConfig.relayListLookupRelays || []),
    ...getAppRelaysForCategory('communikey'),
    ...getFallbackRelays()
  ];
  return [...new Set(relays)];
}
