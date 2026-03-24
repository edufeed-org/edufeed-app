/**
 * Relay Warming Service
 * Pre-establishes relay connections before publish time
 * to make publishing feel instant.
 */
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { pool } from '$lib/stores/nostr-infrastructure.svelte.js';
import { getAppRelaysForCategory, CATEGORIES } from './app-relay-service.svelte.js';
import { fetchRelayList } from './relay-service.svelte.js';
import { getAllCommunityRelays } from '$lib/helpers/communityRelays.js';

/**
 * @typedef {Object} WarmStatus
 * @property {boolean} connected - Whether relay is connected
 * @property {number} lastSuccess - Timestamp of last successful connection
 * @property {number} [lastAttempt] - Timestamp of last warming attempt
 */

/** @type {SvelteMap<string, WarmStatus>} */
const warmStatus = new SvelteMap();

const WARM_TIMEOUT = 5000; // 5s timeout for warming attempts
const WARM_FRESHNESS = 60000; // Consider warm if connected within last 60s
const HEALTH_CHECK_INTERVAL = 30000; // 30s between health checks

/** @type {NodeJS.Timeout | undefined} */
let healthCheckTimer;

/**
 * Wait for relay connection with timeout
 * @param {import('applesauce-relay').Relay} relay
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
function waitForConnection(relay, timeout = WARM_TIMEOUT) {
  return new Promise((resolve) => {
    // Check if already connected
    if (relay.connected) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      sub?.unsubscribe();
      resolve(false);
    }, timeout);

    /** @type {import('rxjs').Subscription | undefined} */
    let sub;
    sub = relay.connected$.subscribe((connected) => {
      if (connected) {
        clearTimeout(timeoutId);
        sub?.unsubscribe();
        resolve(true);
      }
    });
  });
}

/**
 * Warm a single relay (establish connection)
 * @param {string} url - Relay URL
 * @returns {Promise<boolean>} - Whether warming succeeded
 */
async function warmRelay(url) {
  // Skip if already warm and fresh
  if (isWarm(url)) {
    return true;
  }

  const status = warmStatus.get(url) || { connected: false, lastSuccess: 0 };
  status.lastAttempt = Date.now();
  warmStatus.set(url, status);

  try {
    const relay = pool.relay(url);

    // Wait for connection
    const connected = await waitForConnection(relay, WARM_TIMEOUT);
    if (!connected) {
      status.connected = false;
      warmStatus.set(url, status);
      return false;
    }

    status.connected = true;
    status.lastSuccess = Date.now();
    warmStatus.set(url, status);
    return true;
  } catch (_err) {
    status.connected = false;
    warmStatus.set(url, status);
    return false;
  }
}

/**
 * Warm multiple relays in parallel
 * @param {string[]} urls - Relay URLs to warm
 * @returns {Promise<void>}
 */
export async function warmRelays(urls) {
  const uniqueUrls = [...new SvelteSet(urls)].filter(Boolean);
  await Promise.allSettled(uniqueUrls.map((url) => warmRelay(url)));
}

/**
 * Check if a relay is warm (connected and fresh)
 * @param {string} url - Relay URL
 * @returns {boolean}
 */
export function isWarm(url) {
  const status = warmStatus.get(url);
  if (!status) return false;
  return status.connected && Date.now() - status.lastSuccess < WARM_FRESHNESS;
}

/**
 * Get all warm relay URLs
 * @returns {string[]}
 */
export function getWarmRelays() {
  const warm = [];
  for (const [url, status] of warmStatus) {
    if (status.connected && Date.now() - status.lastSuccess < WARM_FRESHNESS) {
      warm.push(url);
    }
  }
  return warm;
}

/**
 * Get warm status for debugging
 * @returns {Map<string, WarmStatus>}
 */
export function getWarmStatus() {
  return new SvelteMap(warmStatus);
}

/**
 * Mark a relay as no longer warm (e.g., on disconnect)
 * @param {string} url - Relay URL
 */
export function markCold(url) {
  const status = warmStatus.get(url);
  if (status) {
    status.connected = false;
    warmStatus.set(url, status);
  }
}

/**
 * Warm all app-specific relays
 * @returns {Promise<void>}
 */
export async function warmAppRelays() {
  const allAppRelays = new SvelteSet();

  for (const category of Object.keys(CATEGORIES)) {
    const relays = getAppRelaysForCategory(category);
    relays.forEach((r) => allAppRelays.add(r));
  }

  await warmRelays(Array.from(allAppRelays));
}

/**
 * Warm a user's write relays (for publishing their events)
 * @param {string} pubkey - User's public key
 * @returns {Promise<void>}
 */
export async function warmUserRelays(pubkey) {
  const relayList = await fetchRelayList(pubkey);
  if (relayList && relayList.writeRelays && relayList.writeRelays.length > 0) {
    await warmRelays(relayList.writeRelays);
  }
}

/**
 * Warm all relays for a community
 * @param {Object} communityEvent - Kind 10222 community definition event
 * @returns {Promise<void>}
 */
export async function warmCommunityRelays(communityEvent) {
  if (!communityEvent) return;
  const relays = getAllCommunityRelays(communityEvent);
  await warmRelays(relays);
}

/**
 * Prefetch relay list for a pubkey (non-blocking, for tagged users)
 * @param {string} pubkey - User's public key
 */
export function prefetchRelayList(pubkey) {
  // Fire and forget - just populate the cache
  fetchRelayList(pubkey).catch(() => {
    // Ignore errors for prefetch
  });
}

/**
 * Prefetch relay lists for multiple pubkeys (for tagged users in composer)
 * @param {string[]} pubkeys - Array of pubkeys
 */
export function prefetchRelayLists(pubkeys) {
  pubkeys.forEach((pk) => prefetchRelayList(pk));
}

/**
 * Health check - verify warm relays are still connected
 */
function healthCheck() {
  for (const [url, status] of warmStatus) {
    if (status.connected) {
      try {
        const relay = pool.relay(url);
        if (!relay.connected) {
          status.connected = false;
          warmStatus.set(url, status);
        }
      } catch {
        status.connected = false;
        warmStatus.set(url, status);
      }
    }
  }
}

/**
 * Start background health checking
 */
export function startHealthCheck() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(healthCheck, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop background health checking
 */
export function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = undefined;
  }
}

/**
 * Clear all warm status (e.g., on logout)
 */
export function clearWarmStatus() {
  warmStatus.clear();
  stopHealthCheck();
}
