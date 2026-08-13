import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { deriveCommunityType } from '$lib/groups/community-membership.js';

/**
 * Custom hook for loading and managing community type (open/moderated/closed).
 * Uses kind 10222 community definition events with addressLoader + eventStore.replaceable pattern.
 *
 * @param {string | (() => string | undefined)} pubkeyOrGetter - Community pubkey string or getter function.
 *                           Use a getter function (e.g., `() => props.pubkey`) to make the hook
 *                           reactive to prop changes.
 * @returns {() => 'open'|'moderated'|'closed'|null} - Reactive getter function returning the community type.
 *                                                      Returns null while loading/unknown.
 */
export function useCommunityType(pubkeyOrGetter) {
  // Store the community type reactively
  let communityType = $state(/** @type {'open'|'moderated'|'closed'|null} */ (null));

  // Normalize pubkey access - support both string and getter function
  const getPubkey = typeof pubkeyOrGetter === 'function' ? pubkeyOrGetter : () => pubkeyOrGetter;

  // Effect to handle community type loading and subscription management
  // Uses the loader + model pattern for reactive updates
  $effect(() => {
    // Reset type when pubkey changes
    communityType = null;

    const pubkey = getPubkey();
    if (!pubkey) return;

    const relays = getCommunikeyRelays();

    // 1. Fetch the community definition event (kind 10222) from communikey relays
    const loaderSubscription = addressLoader({
      kind: 10222,
      pubkey,
      relays
    }).subscribe();

    // 2. Subscribe to EventStore for reactive updates
    const modelSubscription = eventStore.replaceable(10222, pubkey).subscribe((event) => {
      communityType = event ? deriveCommunityType(event) : null;
    });

    return () => {
      loaderSubscription.unsubscribe();
      modelSubscription.unsubscribe();
    };
  });

  // Return a getter function that provides reactive access to the community type
  return () => communityType;
}
