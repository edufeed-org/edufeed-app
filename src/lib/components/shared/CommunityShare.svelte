<!--
  CommunityShare Component
  Reusable component for sharing any content type with communities using NIP-18 reposts (kind 6/16)
  with h-tag community targeting. Also detects legacy kind 30222 shares for backward compat.
-->

<script>
  import { useJoinedCommunitiesList } from '../../stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '../../stores/user-profile.svelte.js';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { SharesModel } from 'applesauce-common/models';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import {
    getDisplayName,
    getAddressPointerForEvent,
    getReplaceableAddress
  } from 'applesauce-core/helpers';
  import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
  import { createCommunityReposts } from '$lib/helpers/communityRepost.js';
  import { PlusIcon, CheckIcon, AlertIcon } from '../icons';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

  /**
   * @typedef {Object} Props
   * @property {any} event - Raw Nostr event to share (any kind: calendar, article, etc.)
   * @property {any} activeUser - Current active user
   * @property {boolean} [compact=false] - Use compact layout
   * @property {string} [shareButtonText='Apply Changes'] - Custom button text
   */

  /** @type {Props} */
  let { event, activeUser, compact = false, shareButtonText = 'Apply Changes' } = $props();

  // Get joined communities
  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // State management
  let selectedCommunityIds = $state(/** @type {string[]} */ ([]));

  // Separate source tracking (plain vars — no $state to avoid effect re-triggers)
  /** @type {Set<string>} */ let _repostCommunities = new Set();
  /** @type {Set<string>} */ let _repostDeletable = new Set();
  /** @type {Set<string>} */ let _legacyCommunities = new Set();
  /** @type {Set<string>} */ let _legacyDeletable = new Set();

  // Combined output state
  /** @type {Set<string>} */
  let communitiesWithShares = $state.raw(new Set());
  /** @type {Set<string>} */
  let deletableShares = $state.raw(new Set());

  /**
   * Recompute combined share state from all sources (repost + legacy + native h-tags).
   * Uses plain vars for sources to avoid $state read+write cycles in effects.
   */
  function updateCombinedShares() {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw
    const combined = new Set();
    // Native h-tags on original event
    if (event?.tags) {
      for (const t of event.tags) {
        if (t[0] === 'h' && t[1]) combined.add(t[1]);
      }
    }
    for (const s of _repostCommunities) combined.add(s);
    for (const s of _legacyCommunities) combined.add(s);
    communitiesWithShares = combined;

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw
    const combinedDel = new Set();
    for (const s of _repostDeletable) combinedDel.add(s);
    for (const s of _legacyDeletable) combinedDel.add(s);
    deletableShares = combinedDel;
  }

  let isCheckingShares = $state(false);
  let isProcessingShares = $state(false);
  let shareError = $state('');
  let shareSuccess = $state('');
  let shareResults = $state({
    successful: /** @type {string[]} */ ([]),
    failed: /** @type {string[]} */ ([])
  });

  /**
   * Get community name for logging purposes
   * @param {string} communityPubkey
   * @returns {string}
   */
  function getCommunityName(communityPubkey) {
    return communityPubkey.slice(0, 8) + '...';
  }

  /**
   * Check which communities already have sharing events for this content.
   * Detects native h-tags on the event, NIP-18 reposts (kind 6/16) by ANY user,
   * and legacy kind 30222 shares by ANY user.
   */
  $effect(() => {
    if (!activeUser || !event || !joinedCommunities.length) {
      _repostCommunities = new Set();
      _repostDeletable = new Set();
      _legacyCommunities = new Set();
      _legacyDeletable = new Set();
      communitiesWithShares = new Set();
      deletableShares = new Set();
      isCheckingShares = false;
      return;
    }

    isCheckingShares = true;

    // Build targeted filters — no authors filter so we detect ALL shares
    const lookupRelays = getAllLookupRelays();
    /** @type {import('nostr-tools').Filter} */
    const repostFilter = { kinds: [6, 16], '#e': [event.id] };
    /** @type {import('nostr-tools').Filter} */
    const legacyFilter = { kinds: [30222], '#e': [event.id] };

    // For addressable events, also search by a-tag (some shares may only have a-tag)
    const isAddressable = event.kind >= 30000 && event.kind < 40000;
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const address = isAddressable ? `${event.kind}:${event.pubkey}:${dTag}` : null;

    // Load ALL shares from relays (both NIP-18 reposts and legacy 30222)
    const repostLoader = createTimelineLoader(pool, lookupRelays, repostFilter, {
      eventStore,
      limit: 50
    });
    const legacyLoader = createTimelineLoader(pool, lookupRelays, legacyFilter, {
      eventStore,
      limit: 50
    });

    const repostLoaderSub = repostLoader().subscribe({
      error: (err) => console.warn('CommunityShare: Repost loader error:', err)
    });
    const legacyLoaderSub = legacyLoader().subscribe({
      error: (err) => console.warn('CommunityShare: Legacy loader error:', err)
    });

    // For addressable events, also query by #a tag (some shares may lack e-tag)
    /** @type {import('rxjs').Subscription | undefined} */
    let repostByAddrSub;
    /** @type {import('rxjs').Subscription | undefined} */
    let legacyByAddrSub;
    if (address) {
      const repostByAddrLoader = createTimelineLoader(
        pool,
        lookupRelays,
        { kinds: [6, 16], '#a': [address] },
        { eventStore, limit: 50 }
      );
      const legacyByAddrLoader = createTimelineLoader(
        pool,
        lookupRelays,
        { kinds: [30222], '#a': [address] },
        { eventStore, limit: 50 }
      );
      repostByAddrSub = repostByAddrLoader().subscribe({
        error: (err) => console.warn('CommunityShare: Repost addr loader error:', err)
      });
      legacyByAddrSub = legacyByAddrLoader().subscribe({
        error: (err) => console.warn('CommunityShare: Legacy addr loader error:', err)
      });
    }

    // SharesModel handles kind 6/16 matching (no author filter, uses buildCommonEventRelationFilters)
    const sharesModelSub = eventStore.model(SharesModel, event).subscribe((repostEvents) => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to callback, assigned to plain var
      const communities = new Set();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to callback, assigned to plain var
      const userDeletable = new Set();

      for (const repost of repostEvents || []) {
        for (const tag of repost.tags) {
          if (tag[0] === 'h' && tag[1]) {
            communities.add(tag[1]);
            if (repost.pubkey === activeUser.pubkey) {
              userDeletable.add(tag[1]);
            }
          }
        }
      }

      _repostCommunities = communities;
      _repostDeletable = userDeletable;
      updateCombinedShares();
      isCheckingShares = false;
    });

    // Legacy 30222 detection — kept separate since SharesModel only covers kind 6/16
    const legacyModelSub = eventStore.timeline({ kinds: [30222] }).subscribe((legacyEvents) => {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to callback, assigned to plain var
      const communities = new Set();
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to callback, assigned to plain var
      const userDeletable = new Set();

      for (const shareEvent of legacyEvents || []) {
        const aTag = shareEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'a');
        const eTag = shareEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'e');

        let matchesEvent = false;
        if (aTag) {
          const eventPointer = getAddressPointerForEvent(event);
          const sharePointer = parseAddressPointerFromATag(aTag);
          if (eventPointer && sharePointer) {
            matchesEvent =
              eventPointer.identifier === sharePointer.identifier &&
              eventPointer.kind === sharePointer.kind &&
              eventPointer.pubkey === sharePointer.pubkey;
          }
        }
        if (!matchesEvent && eTag && eTag[1] === event.id) {
          matchesEvent = true;
        }

        if (matchesEvent) {
          const pTag = shareEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'p');
          if (pTag?.[1]) {
            communities.add(pTag[1]);
            if (shareEvent.pubkey === activeUser.pubkey) {
              userDeletable.add(pTag[1]);
            }
          }
        }
      }

      _legacyCommunities = communities;
      _legacyDeletable = userDeletable;
      updateCombinedShares();
    });

    return () => {
      repostLoaderSub.unsubscribe();
      legacyLoaderSub.unsubscribe();
      repostByAddrSub?.unsubscribe();
      legacyByAddrSub?.unsubscribe();
      sharesModelSub.unsubscribe();
      legacyModelSub.unsubscribe();
    };
  });

  /**
   * Delete a community share — finds the repost (kind 6/16 with matching h-tag)
   * or legacy 30222 and deletes it.
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function deleteShare(communityPubkey) {
    if (!activeUser || !event) {
      throw new Error('Missing user or event data');
    }

    return new Promise((resolve) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;
      sub = eventStore
        .timeline({
          kinds: [6, 16, 30222],
          authors: [activeUser.pubkey]
        })
        .subscribe(async (allShares) => {
          if (sub) sub.unsubscribe();

          // Find matching share (prefer NIP-18 repost, fall back to legacy 30222)
          let matchingShare = null;
          let legacyMatch = null;

          for (const share of allShares) {
            if (share.kind === 6 || share.kind === 16) {
              // NIP-18 repost: match by e-tag + h-tag
              const eTag = share.tags.find((t) => t[0] === 'e');
              const aTag = share.tags.find((t) => t[0] === 'a');
              const hasHTag = share.tags.some((t) => t[0] === 'h' && t[1] === communityPubkey);

              if (!hasHTag) continue;

              if (eTag?.[1] === event.id) {
                matchingShare = share;
                break;
              }
              if (aTag) {
                const isReplaceable = event.kind >= 30000 && event.kind < 40000;
                if (isReplaceable && aTag[1] === getReplaceableAddress(event)) {
                  matchingShare = share;
                  break;
                }
              }
            } else if (share.kind === 30222) {
              // Legacy 30222: match by p-tag + e/a-tag
              const pTag = share.tags.find((t) => t[0] === 'p');
              const eTag = share.tags.find((t) => t[0] === 'e');
              const aTag = share.tags.find((t) => t[0] === 'a');

              if (pTag?.[1] !== communityPubkey) continue;

              const isReplaceable = event.kind >= 30000 && event.kind < 40000;
              if (
                eTag?.[1] === event.id ||
                (isReplaceable && aTag?.[1] === getReplaceableAddress(event))
              ) {
                legacyMatch = share;
              }
            }
          }

          const toDelete = matchingShare || legacyMatch;

          if (toDelete) {
            const result = await deleteEvent(toDelete, activeUser);
            resolve(result.success);
          } else {
            resolve(true); // Consider successful if already gone
          }
        });
    });
  }

  /**
   * Handle applying community sharing changes
   */
  async function handleApplyShares() {
    if (selectedCommunityIds.length === 0 || !activeUser || !event) {
      return;
    }

    isProcessingShares = true;
    shareError = '';
    shareSuccess = '';
    shareResults = { successful: [], failed: [] };

    try {
      // Separate into creates vs deletes (only deletable shares can be unshared)
      const toCreate = selectedCommunityIds.filter((id) => !deletableShares.has(id));
      const toDelete = selectedCommunityIds.filter((id) => deletableShares.has(id));

      // Batch create: ONE sign call for all new shares
      if (toCreate.length > 0) {
        try {
          const success = await createCommunityReposts(event, toCreate, activeUser.signer);
          if (success) {
            for (const id of toCreate) shareResults.successful.push(getCommunityName(id));
          } else {
            for (const id of toCreate) shareResults.failed.push(getCommunityName(id));
          }
        } catch (error) {
          console.error('CommunityShare: Failed to batch create shares:', error);
          for (const id of toCreate) shareResults.failed.push(getCommunityName(id));
        }
      }

      // Deletions need individual sign calls (each targets a different event)
      for (const communityPubkey of toDelete) {
        const communityName = getCommunityName(communityPubkey);
        try {
          const success = await deleteShare(communityPubkey);
          if (success) {
            shareResults.successful.push(communityName);
          } else {
            shareResults.failed.push(communityName);
          }
        } catch (error) {
          console.error(`CommunityShare: Failed to delete share for ${communityPubkey}:`, error);
          shareResults.failed.push(communityName);
        }
      }

      const successfulCount = shareResults.successful.length;
      const failedCount = shareResults.failed.length;

      if (successfulCount > 0) {
        shareSuccess = `Successfully shared with ${successfulCount} community${successfulCount > 1 ? 'ies' : ''}`;
        if (failedCount > 0) {
          shareSuccess += `, failed for ${failedCount}`;
        }
      } else if (failedCount > 0) {
        shareError = `Failed to share with ${failedCount} community${failedCount > 1 ? 'ies' : ''}`;
      }

      selectedCommunityIds = [];
    } catch (error) {
      console.error('CommunityShare: Error applying shares:', error);
      shareError = error instanceof Error ? error.message : 'Failed to apply sharing changes';
    } finally {
      isProcessingShares = false;
    }
  }

  /**
   * Toggle community selection
   * @param {string} communityPubkey
   */
  function toggleCommunitySelection(communityPubkey) {
    if (selectedCommunityIds.includes(communityPubkey)) {
      selectedCommunityIds = selectedCommunityIds.filter((id) => id !== communityPubkey);
    } else {
      selectedCommunityIds = [...selectedCommunityIds, communityPubkey];
    }
  }

  /**
   * Select all communities that don't have non-deletable shares
   */
  function selectAllCommunities() {
    const availableCommunities = joinedCommunities.filter((pubkey) => {
      // Skip only communities where user already has their own share
      return !deletableShares.has(pubkey);
    });
    selectedCommunityIds = availableCommunities;
  }

  /**
   * Deselect all communities
   */
  function deselectAllCommunities() {
    selectedCommunityIds = [];
  }
</script>

<!-- Community Sharing UI -->
<div class="community-share" class:compact>
  <div class="mb-3">
    <div class="mb-2 flex items-center justify-between">
      <div class="block text-sm font-medium text-base-content">
        {compact ? 'Share with Communities' : 'Select Communities'}
      </div>
      {#if joinedCommunities.length > 1}
        <div class="flex gap-2">
          <button
            class="btn btn-ghost btn-xs"
            onclick={selectAllCommunities}
            disabled={selectedCommunityIds.length === joinedCommunities.length || isCheckingShares}
          >
            Select All
          </button>
          <button
            class="btn btn-ghost btn-xs"
            onclick={deselectAllCommunities}
            disabled={selectedCommunityIds.length === 0}
          >
            Deselect All
          </button>
        </div>
      {/if}
    </div>

    <!-- Community Checkboxes -->
    {#if isCheckingShares}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-spinner {compact ? 'loading-sm' : 'loading-md'}"></span>
        <span class="ml-2 text-sm text-base-content/70">Checking existing shares...</span>
      </div>
    {:else if joinedCommunities.length > 0}
      <div class="max-h-40 overflow-y-auto rounded-lg border border-base-300 p-3">
        {#each joinedCommunities as communityPubKey (communityPubKey)}
          {@const isAlreadyShared = communitiesWithShares.has(communityPubKey)}
          {@const isDeletable = deletableShares.has(communityPubKey)}
          {@const isNonDeletable = isAlreadyShared && !isDeletable}
          {@const isSelected = selectedCommunityIds.includes(communityPubKey)}
          {@const getCommunityProfile = useUserProfile(communityPubKey)}
          {@const communityProfile = getCommunityProfile()}
          <label class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-200">
            <input
              type="checkbox"
              class="checkbox checkbox-secondary {compact ? 'checkbox-sm' : ''}"
              checked={isSelected}
              disabled={isProcessingShares}
              onchange={() => toggleCommunitySelection(communityPubKey)}
            />
            <span class="font-medium {compact ? 'text-sm' : ''}">
              {getDisplayName(communityProfile) ||
                `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
            </span>
            {#if isDeletable && isSelected}
              <span class="text-xs font-medium text-warning">(Will be unshared)</span>
            {:else if isDeletable}
              <span class="text-xs font-medium text-success">(Shared - click to unshare)</span>
            {:else if isNonDeletable}
              <span class="text-xs font-medium text-success/70">(Shared by others)</span>
            {:else if isSelected}
              <span class="text-xs font-medium text-info">(Will be shared)</span>
            {/if}
          </label>
        {/each}
      </div>

      <!-- Selected Communities Summary -->
      {#if selectedCommunityIds.length > 0}
        <div class="mt-2 text-sm text-base-content/70">
          {selectedCommunityIds.length} community{selectedCommunityIds.length > 1 ? 'ies' : ''} selected
        </div>
      {/if}
    {:else}
      <div class="py-4 text-center text-base-content/60 {compact ? 'text-sm' : ''}">
        No joined communities available
      </div>
    {/if}
  </div>

  <!-- Apply Button -->
  <div class="flex items-center gap-3">
    <button
      class="btn btn-secondary {compact ? 'btn-block btn-sm' : ''}"
      disabled={selectedCommunityIds.length === 0 || isProcessingShares}
      onclick={handleApplyShares}
    >
      {#if isProcessingShares}
        <span class="loading loading-spinner {compact ? 'loading-sm' : ''}"></span>
        Applying changes...
      {:else}
        <PlusIcon class_="w-4 h-4 mr-2" />
        {shareButtonText}
      {/if}
    </button>
  </div>

  <!-- Success Message -->
  {#if shareSuccess}
    <div class="mt-3 alert alert-success {compact ? 'py-2' : ''}">
      <CheckIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{shareSuccess}</span>
    </div>
  {/if}

  <!-- Error Message -->
  {#if shareError}
    <div class="mt-3 alert alert-error {compact ? 'py-2' : ''}">
      <AlertIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{shareError}</span>
    </div>
  {/if}
</div>
