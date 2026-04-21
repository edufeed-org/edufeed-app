import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';

const COMMUNITIES_SET_ID = 'communities';

/**
 * Custom hook for loading and managing joined communities list
 * Uses kind 30000 follow set with d="communities" (NIP-51)
 * @returns {() => string[]} - Function returning reactive array of joined community pubkeys
 */
export function useJoinedCommunitiesList() {
  let activeUser = $state(manager.active);
  let joinedCommunities = $state(/** @type {string[]} */ ([]));

  // Subscribe to account changes
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Load follow set using addressLoader + replaceable subscription
  $effect(() => {
    if (!activeUser?.pubkey) {
      joinedCommunities = [];
      return;
    }

    const pubkey = activeUser.pubkey;
    // Use all lookup relays as initial set
    const relays = getAllLookupRelays();

    /** @type {import('rxjs').Subscription | undefined} */
    let writeRelaySub;

    // 1. Fetch the follow set from app/lookup relays
    const loaderSubscription = addressLoader({
      kind: 30000,
      pubkey,
      identifier: COMMUNITIES_SET_ID,
      relays
    }).subscribe();

    // 2. Also fetch from user's NIP-65 write relays (outbox model)
    // The follow set is a user-owned event that may only exist on their write relays,
    // which may not overlap with app relays (especially in gated mode)
    getWriteRelays(pubkey).then((writeRelays) => {
      const newRelays = writeRelays.filter((r) => !relays.includes(r));
      if (newRelays.length > 0) {
        writeRelaySub = addressLoader({
          kind: 30000,
          pubkey,
          identifier: COMMUNITIES_SET_ID,
          relays: newRelays
        }).subscribe();
      }
    });

    // 3. Subscribe to EventStore for reactive updates
    const modelSubscription = eventStore
      .replaceable(30000, pubkey, COMMUNITIES_SET_ID)
      .subscribe((event) => {
        if (event) {
          const pointers = getProfilePointersFromList(event);
          joinedCommunities = pointers.map((p) => p.pubkey);
        } else {
          joinedCommunities = [];
        }
      });

    return () => {
      loaderSubscription.unsubscribe();
      writeRelaySub?.unsubscribe();
      modelSubscription.unsubscribe();
    };
  });

  return () => joinedCommunities;
}

/**
 * Custom hook for checking community membership status
 * @param {string | (() => string | undefined)} communityPubkeyOrGetter - The pubkey of the community or a getter function.
 *                           Use a getter function (e.g., `() => props.pubkey`) to make the hook
 *                           reactive to prop changes and avoid `state_referenced_locally` warnings.
 * @returns {() => boolean} - Reactive getter function indicating if current user has joined the community
 */
export function useCommunityMembership(communityPubkeyOrGetter) {
  const getJoinedCommunities = useJoinedCommunitiesList();

  // Normalize pubkey access - support both string and getter function
  const getCommunityPubkey =
    typeof communityPubkeyOrGetter === 'function'
      ? communityPubkeyOrGetter
      : () => communityPubkeyOrGetter;

  // Derive joined status from current state
  const joined = $derived.by(() => {
    const communityPubkey = getCommunityPubkey();
    if (!communityPubkey) {
      return false;
    }

    const joinedCommunities = getJoinedCommunities();
    return joinedCommunities.includes(communityPubkey);
  });

  return () => joined;
}
