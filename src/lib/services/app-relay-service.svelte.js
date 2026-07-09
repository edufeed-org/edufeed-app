/**
 * App Relay Service - NIP-51 Relay Sets for app-specific relays
 *
 * Users can override app relays via kind 30002 events with app-specific d-tags.
 * D-tags are based on APP_NAME from config (e.g., "ComCal/calendar")
 */
import { writable } from 'svelte/store';
import { SvelteMap } from 'svelte/reactivity';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * App relay categories with their associated event kinds
 */
export const CATEGORIES = {
  calendar: {
    kinds: [31922, 31923, 31924, 31925],
    label: 'Calendar Events'
  },
  communikey: {
    kinds: [11, 10222, 30222, 30168, 1069, 1070],
    label: 'Community Events'
  },
  educational: {
    kinds: [30142],
    label: 'Educational Resources'
  },
  longform: {
    kinds: [30023],
    label: 'Articles & Long-form Content'
  },
  kanban: {
    kinds: [30301, 30302, 8571],
    label: 'Kanban Boards'
  }
};

/**
 * Get d-tag for a category based on APP_NAME from config
 * Example: APP_NAME="ComCal" → "ComCal/calendar"
 * @param {string} category - 'calendar' | 'communikey' | 'educational'
 * @returns {string}
 */
export function getRelaySetDTag(category) {
  const appName = runtimeConfig.appName || 'ComCal';
  return `${appName}/${category}`;
}

/**
 * Reactive cache for user's relay set overrides (populated by subscriptions).
 * SvelteMap is already reactive, no $state wrapper needed.
 * @type {SvelteMap<string, string[]>}
 */
let userOverrideCache = new SvelteMap();

/**
 * Reactive signal for relay updates - Svelte writable store for cross-component reactivity.
 * Use $relayUpdateSignal (with $ prefix) in .svelte components to auto-subscribe.
 * @type {import('svelte/store').Writable<number>}
 */
export const relayUpdateSignal = writable(0);

/**
 * Update the cache for a category (called from subscription in settings page)
 * Mutates in place to preserve reactive subscriptions from $effect() calls
 * @param {string} category - Category name
 * @param {string[]} relays - Relay URLs
 */
export function updateUserOverrideCache(category, relays) {
  userOverrideCache.set(category, relays);
  relayUpdateSignal.update((n) => n + 1); // Trigger reactive updates via store
}

/**
 * Clear the cache (on logout)
 * Clears in place to preserve reactive subscriptions from $effect() calls
 */
export function clearUserOverrideCache() {
  userOverrideCache.clear();
}

/**
 * Get user's relay set override from cache
 * @param {string} category - 'calendar' | 'communikey' | 'educational'
 * @returns {string[]} Relay URLs from user's relay set, or empty array
 */
export function getUserRelaySetOverride(category) {
  return userOverrideCache.get(category) || [];
}

/**
 * Get server default relays for a category
 * @param {string} category - 'calendar' | 'communikey' | 'educational' | 'longform'
 * @returns {string[]}
 */
export function getDefaultRelaysForCategory(category) {
  switch (category) {
    case 'calendar':
      return runtimeConfig.appRelays?.calendar || [];
    case 'communikey':
      return runtimeConfig.appRelays?.communikey || [];
    case 'educational':
      return runtimeConfig.appRelays?.educational || [];
    case 'longform':
      return runtimeConfig.appRelays?.longform || [];
    case 'kanban':
      return runtimeConfig.appRelays?.kanban || [];
    default:
      return [];
  }
}

/**
 * Get effective app relays for category (user override or server default)
 * @param {string} category - 'calendar' | 'communikey' | 'educational'
 * @returns {string[]}
 */
export function getAppRelaysForCategory(category) {
  // Check for user's kind 30002 relay set override
  const userOverride = getUserRelaySetOverride(category);
  if (userOverride.length > 0) {
    return userOverride;
  }

  // Fall back to server defaults
  return getDefaultRelaysForCategory(category);
}

/**
 * Check if user has a relay set override for a category
 * @param {string} category - Category name
 * @returns {boolean}
 */
export function hasOverrideForCategory(category) {
  return getUserRelaySetOverride(category).length > 0;
}

/**
 * Map event kind to app relay category
 * @param {number} kind - Nostr event kind
 * @returns {string|null} Category name or null if not an app relay kind
 */
export function kindToAppRelayCategory(kind) {
  if ([31922, 31923, 31924, 31925].includes(kind)) return 'calendar';
  if ([11, 10222, 30222, 30168, 1069, 1070].includes(kind)) return 'communikey';
  if ([30142, 1063, 30040].includes(kind)) return 'educational';
  if ([30023].includes(kind)) return 'longform';
  if ([30301, 30302, 8571].includes(kind)) return 'kanban';
  return null;
}

/**
 * Parse relay URLs from a kind 30002 event
 * @param {import('nostr-tools').NostrEvent | null | undefined} event - Kind 30002 event
 * @returns {string[]} Array of relay URLs
 */
export function parseRelaySetEvent(event) {
  if (!event?.tags) return [];

  return event.tags
    .filter((/** @type {string[]} */ t) => t[0] === 'relay')
    .map((/** @type {string[]} */ t) => t[1])
    .filter(Boolean);
}
