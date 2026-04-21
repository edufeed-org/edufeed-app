import { subscribeProfile } from '$lib/stores/profile-subscription.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

/**
 * Custom hook for loading and managing user profile data using the loader + model pattern.
 * This ensures reactive updates when profiles change (e.g., via EditProfileModal).
 *
 * @param {string | (() => string | undefined)} [pubkeyOrGetter] - Pubkey string or getter function.
 *                           If not provided, uses the active user's pubkey from manager.active.
 *                           Use a getter function (e.g., `() => props.pubkey`) to make the hook
 *                           reactive to prop changes.
 * @returns {() => any} - Reactive getter function returning the user profile
 */
export function useUserProfile(pubkeyOrGetter) {
  // Store the profile data reactively
  let profile = $state(/** @type {any} */ (null));

  // Use the proper hook for active user
  const getActiveUser = useActiveUser();

  // Normalize pubkey access - support both string and getter function
  const getPubkey = typeof pubkeyOrGetter === 'function' ? pubkeyOrGetter : () => pubkeyOrGetter;

  // Effect to handle profile loading and subscription management
  // Uses the loader + model pattern for reactive updates
  $effect(() => {
    // Reset profile when pubkey changes or when active account changes
    profile = null;

    // Determine the target pubkey: use provided pubkey or fallback to active user's pubkey
    const targetPubkey = getPubkey() || getActiveUser()?.pubkey;

    if (targetPubkey) {
      const sub = subscribeProfile(targetPubkey, (profileContent) => {
        profile = profileContent;
      });
      return () => sub.unsubscribe();
    }
  });

  // Return a getter function that provides reactive access to the profile
  return () => profile;
}
