/**
 * Reactive hook for batch profile loading.
 * Delegates per-pubkey load+subscribe to `subscribeProfile`, which fires an
 * explicit `profileLoader` fetch (with indexer relays) and subscribes to the
 * eventStore ProfileModel. This matches the pattern used by `useUserProfile`
 * for single-pubkey loading.
 *
 * NOTE: This hook intentionally uses regular Map (not SvelteMap) for internal tracking.
 * Using SvelteMap inside subscription callbacks causes effect_update_depth_exceeded errors.
 * See: https://svelte.dev/docs/svelte/svelte-reactivity#SvelteMap
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
import { subscribeProfile } from '$lib/stores/profile-subscription.js';

/**
 * Hook: Subscribe to profiles for a reactive collection of pubkeys.
 * Creates one `subscribeProfile` primitive per unique pubkey — each fires
 * an explicit profileLoader fetch (batched via addressLoader bufferTime)
 * and subscribes to the eventStore ProfileModel.
 *
 * @param {() => Iterable<string>} getPubkeys - Reactive getter returning pubkeys to load
 * @returns {() => Map<string, any>} Reactive getter for pubkey → profile Map
 */
export function useProfileMap(getPubkeys) {
  /** @type {Map<string, { unsubscribe: () => void }>} */
  const subscriptions = new Map();
  const profilesMap = new Map();
  let profiles = $state(/** @type {Map<string, any>} */ (new Map()));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let updateTimer;

  // Subscribe to new pubkeys, clean up removed ones
  $effect(() => {
    const pubkeys = new Set(getPubkeys());

    // Unsubscribe pubkeys no longer in the set
    for (const [pubkey, sub] of subscriptions) {
      if (!pubkeys.has(pubkey)) {
        sub.unsubscribe();
        subscriptions.delete(pubkey);
        profilesMap.delete(pubkey);
      }
    }

    // Subscribe to new pubkeys via the shared loader + model primitive
    for (const pubkey of pubkeys) {
      if (subscriptions.has(pubkey)) continue;

      const sub = subscribeProfile(pubkey, (profile) => {
        if (profile) {
          profilesMap.set(pubkey, profile);
          clearTimeout(updateTimer);
          updateTimer = setTimeout(() => {
            profiles = new Map(profilesMap);
          }, 50);
        }
      });

      subscriptions.set(pubkey, sub);
    }
  });

  // Cleanup on destroy
  $effect(() => {
    return () => {
      clearTimeout(updateTimer);
      for (const sub of subscriptions.values()) {
        sub.unsubscribe();
      }
      subscriptions.clear();
      profilesMap.clear();
    };
  });

  return () => profiles;
}
