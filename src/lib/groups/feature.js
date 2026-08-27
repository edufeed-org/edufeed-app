// Moderated communities need both the deployment flag and a group host.
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';

/**
 * @param {{enabled?: boolean, relays?: string[]}} input
 * @returns {boolean}
 */
export function groupsFeatureAvailable({ enabled, relays } = {}) {
  return enabled === true && Array.isArray(relays) && relays.length > 0;
}

/** @returns {boolean} */
export function moderatedCreationAvailable() {
  return groupsFeatureAvailable({
    enabled: runtimeConfig.groupsEnabled,
    relays: getGroupsRelays()
  });
}
