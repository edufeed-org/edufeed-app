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
import { normalizePubkey } from '$lib/helpers/pubkey.js';

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
 * Get the relays an identity event (kind 0/3/10002/10050/10063 — see
 * `identity-kinds.js`) must reach, on top of the author's NIP-65 write relays.
 *
 * The write relays alone are not enough, and cannot be: a client that rewrites
 * a user's kind 10002 down to one relay (measured in the wild, 2026-09-18)
 * also narrows every profile update that follows to that one relay, so the
 * user's name silently disappears from the rest of the network — and the very
 * event that would say where to look is confined there too. NIP-65 therefore
 * asks clients to spread identity events "to as many relays as viable, paying
 * attention to relays that ... serve as well-known public indexers"; Amethyst
 * broadcasts kind 0 and kind 10002 to its indexer list plus every relay it
 * knows.
 *
 * Intentionally NOT gated, for the same reason as getDefaultRelayList() and
 * getDefaultDmRelays(): gated mode narrows what a deployment's users *read*.
 * Withholding their profile from the indexes would not protect anything — the
 * kind 10002 they publish names those public relays anyway — it would only
 * make them unresolvable in every other client. A deployment that must keep
 * profiles in-house points INDEXER_RELAYS / FALLBACK_RELAYS at its own relays.
 *
 * @returns {string[]}
 */
export function getIdentityBroadcastRelays() {
  return [
    ...new Set([
      ...(runtimeConfig.indexerRelays || []),
      ...(runtimeConfig.relayListLookupRelays || []),
      ...(runtimeConfig.fallbackRelays || [])
    ])
  ];
}

/**
 * Fallback relays for personal notification queries (inbox).
 * Intentionally NOT gated: notification queries are p-tagged to the user —
 * social signals, not content feeds — mirroring how WoT filtering exempts
 * social content. External clients publish reactions/replies only to public
 * relays, so a gated inbox would silently miss them (issue #43).
 * @returns {string[]}
 */
export function getNotificationFallbackRelays() {
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

/**
 * NIP-50 capable relays for free-text profile search (kind 0 + `search`).
 * Deliberately NOT unioned with the lookup relays: strfry-based ones reject
 * the `search` filter field outright ("bad req: unrecognised filter item"),
 * so querying them only burns the request timeout. Configured via
 * PROFILE_SEARCH_RELAYS; empty means no remote leg (ContactSearchInput's
 * `searchProfiles` mode then only offers follows + locally known profiles).
 * @returns {string[]}
 */
export function getProfileSearchRelays() {
  return [...new Set(runtimeConfig.profileSearchRelays || [])];
}

/**
 * Point of view for WoT-ranked profile search (PROFILE_SEARCH_OBSERVER),
 * as hex. `null` when unset or unparsable — the search then runs from the
 * relay's own perspective.
 * @returns {string | null}
 */
export function getProfileSearchObserver() {
  const raw = runtimeConfig.profileSearchObserver;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return normalizePubkey(raw.trim()) || null;
}

/**
 * Relays serving NIP-85 trusted assertions (kind 30382). Empty = the
 * trust-score layer is off.
 * @returns {string[]}
 */
export function getTrustAssertionRelays() {
  return [...new Set(runtimeConfig.trustAssertions?.relays || [])];
}

/**
 * Provider keys (hex) whose kind 30382 assertions the app trusts. Config
 * may hold npub or hex; unparsable entries are dropped so a typo never
 * reaches a relay filter.
 * @returns {string[]}
 */
export function getTrustAssertionProviders() {
  const out = new Set();
  for (const raw of runtimeConfig.trustAssertions?.providers || []) {
    const hex = typeof raw === 'string' ? normalizePubkey(raw.trim()) : null;
    if (hex) out.add(hex);
  }
  return [...out];
}

/**
 * NIP-29 group host relays for the create-group flow. Deliberately NO
 * fallback union — fallback relays are not group hosts; empty means the
 * deployment ships no default and the form requires a relay by hand.
 * @returns {string[]}
 */
export function getGroupsRelays() {
  return runtimeConfig.appRelays?.groups ?? [];
}
