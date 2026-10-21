/**
 * Defaults a new community definition (kind 10222) starts with.
 *
 * Both come from the deployment config, never from a literal: publishEvent
 * sends the 10222 to the relays in its own r-tags, so a hardcoded relay here
 * makes every community — from e2e runs, local live checks, whitelabel
 * deployments — land on that relay regardless of COMMUNIKEY_RELAYS.
 */
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { normalizeRelayInput } from '$lib/helpers/relay-input.js';

/**
 * The communikey relays (user kind 30002 override, else COMMUNIKEY_RELAYS),
 * as bare r-tag URLs. Fallback relays are deliberately not included — they
 * are general-purpose read relays, not where a community lives.
 * @returns {string[]}
 */
export function getDefaultCommunityRelays() {
  const relays = getAppRelaysForCategory('communikey')
    .map((url) => normalizeRelayInput(url, { trailingSlash: false }))
    .filter((url) => url !== null);
  return [...new Set(relays)];
}

/**
 * The deployment's default Blossom servers (DEFAULT_BLOSSOM_SERVERS).
 * @returns {string[]}
 */
export function getDefaultCommunityBlossomServers() {
  return [...(runtimeConfig.defaultBlossomServers ?? [])];
}
