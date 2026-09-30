import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { probeCommunitiesFollowSet } from '$lib/helpers/follow-set-probe.js';

const COMMUNITIES_SET_ID = 'communities';

/**
 * @typedef {'loading' | 'ready' | 'unavailable'} JoinedCommunitiesStatus
 * - 'loading'     — nothing known yet
 * - 'ready'       — the list is loaded, or the network confirmed there is none
 * - 'unavailable' — the relays didn't answer; an empty list here means
 *                   "unknown", NOT "you follow no communities"
 */

/**
 * Custom hook for loading and managing joined communities list
 * Uses kind 30000 follow set with d="communities" (NIP-51)
 * @returns {() => string[]} - Function returning reactive array of joined community pubkeys
 */
export function useJoinedCommunitiesList() {
  return useJoinedCommunities(false).list;
}

/**
 * The joined-communities list plus whether it can be trusted. Surfaces that
 * render an empty state must use this: showing "you follow no communities"
 * for a list that merely failed to load is what made a user re-follow and
 * overwrite their real membership list (2026-09-30).
 *
 * @returns {{ list: () => string[], status: () => JoinedCommunitiesStatus, retry: () => void }}
 */
export function useJoinedCommunitiesState() {
  return useJoinedCommunities(true);
}

/**
 * @param {boolean} withStatus - probe the network so status() can tell an
 *   empty list from an unreachable one. List-only consumers skip it: they'd
 *   re-probe every relay on each mount for users who have no list.
 */
function useJoinedCommunities(withStatus) {
  let activeUser = $state(manager.active);
  let joinedCommunities = $state(/** @type {string[]} */ ([]));
  let hasEvent = $state(false);
  let probe = $state(/** @type {'pending' | 'found' | 'absent' | 'unknown'} */ ('pending'));
  let attempt = $state(0);

  // Subscribe to account changes. Guarded: a partial manager (a test double, or
  // a transient pre-init state) without `active$` must not crash the effect —
  // in that case activeUser simply stays at its initial `manager.active`.
  $effect(() => {
    const subscription = manager.active$?.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription?.unsubscribe();
  });

  // Load follow set using addressLoader + replaceable subscription
  $effect(() => {
    if (!activeUser?.pubkey) {
      joinedCommunities = [];
      hasEvent = false;
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
        hasEvent = Boolean(event);
      });

    return () => {
      loaderSubscription.unsubscribe();
      writeRelaySub?.unsubscribe();
      modelSubscription.unsubscribe();
    };
  });

  // 4. Find out whether an empty list is real. The loaders above can't say:
  // they end the same way whether relays answered "none" or never answered.
  $effect(() => {
    const pubkey = activeUser?.pubkey;
    void attempt; // retry() re-runs this effect
    if (!withStatus || !pubkey) return;

    let cancelled = false;
    probe = 'pending';
    probeCommunitiesFollowSet(pubkey).then((result) => {
      if (!cancelled) probe = result;
    });
    return () => {
      cancelled = true;
    };
  });

  const status = $derived(
    /** @type {JoinedCommunitiesStatus} */ (
      hasEvent || probe === 'absent' || !activeUser?.pubkey
        ? 'ready'
        : probe === 'unknown'
          ? 'unavailable'
          : 'loading'
    )
  );

  return {
    list: () => joinedCommunities,
    status: () => status,
    retry: () => {
      attempt++;
    }
  };
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
