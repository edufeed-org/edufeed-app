<!--
  CommunityShare Component
  Reusable component for sharing any content type with communities using NIP-18 reposts (kind 6/16)
  with h-tag community targeting. Also detects legacy kind 30222 shares for backward compat.
-->

<script>
  import { useJoinedCommunitiesList } from '../../stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '../../stores/user-profile.svelte.js';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { TimelineModel } from 'applesauce-core/models';
  import { publishEvent } from '$lib/services/publish-service.js';
  import {
    getDisplayName,
    getAddressPointerForEvent,
    getReplaceableAddress
  } from 'applesauce-core/helpers';
  import 'applesauce-common/blueprints';
  import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
  import { PlusIcon, CheckIcon, AlertIcon } from '../icons';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';

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
  /** @type {Set<string>} */
  let communitiesWithShares = $state.raw(new Set());
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
   * Detects both NIP-18 reposts (kind 6/16 with h-tag) and legacy 30222 shares.
   */
  $effect(() => {
    if (!activeUser || !event || !joinedCommunities.length) {
      communitiesWithShares = new Set();
      isCheckingShares = false;
      return;
    }

    isCheckingShares = true;

    // Load user's shares from relays (both NIP-18 reposts and legacy 30222)
    const repostLoader = createTimelineLoader(
      pool,
      runtimeConfig.fallbackRelays || [],
      { kinds: [6, 16], authors: [activeUser.pubkey] },
      { eventStore, limit: 100 }
    );
    const legacyLoader = createTimelineLoader(
      pool,
      runtimeConfig.fallbackRelays || [],
      { kinds: [30222], authors: [activeUser.pubkey] },
      { eventStore, limit: 100 }
    );

    const repostLoaderSub = repostLoader().subscribe({
      error: (err) => console.warn('CommunityShare: Repost loader error:', err)
    });
    const legacyLoaderSub = legacyLoader().subscribe({
      error: (err) => console.warn('CommunityShare: Legacy loader error:', err)
    });

    // Subscribe to combined model for reactive updates
    const modelSub = eventStore
      .model(TimelineModel, {
        kinds: [6, 16, 30222],
        authors: [activeUser.pubkey]
      })
      .subscribe((shareEvents) => {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw, not reactive
        const shares = new Set();
        for (const shareEvent of shareEvents || []) {
          if (shareEvent.kind === 6 || shareEvent.kind === 16) {
            // NIP-18 repost: check e/a tag matches our event, extract h-tag for community
            const eTag = shareEvent.tags.find((t) => t[0] === 'e');
            const aTag = shareEvent.tags.find((t) => t[0] === 'a');

            let matchesEvent = false;
            if (eTag && eTag[1] === event.id) {
              matchesEvent = true;
            } else if (aTag) {
              const eventPointer = getAddressPointerForEvent(event);
              const sharePointer = parseAddressPointerFromATag(aTag);
              if (eventPointer && sharePointer) {
                matchesEvent =
                  eventPointer.identifier === sharePointer.identifier &&
                  eventPointer.kind === sharePointer.kind &&
                  eventPointer.pubkey === sharePointer.pubkey;
              }
            }

            if (matchesEvent) {
              // Extract all h-tags (community targets)
              for (const tag of shareEvent.tags) {
                if (tag[0] === 'h' && tag[1]) {
                  shares.add(tag[1]);
                }
              }
            }
          } else if (shareEvent.kind === 30222) {
            // Legacy targeted publication: check e/a tag matches, extract p-tag for community
            const aTag = shareEvent.tags.find((t) => t[0] === 'a');
            const eTag = shareEvent.tags.find((t) => t[0] === 'e');

            if (aTag) {
              const eventPointer = getAddressPointerForEvent(event);
              const sharePointer = parseAddressPointerFromATag(aTag);

              if (!sharePointer || !eventPointer) continue;

              const idMatch = eventPointer.identifier === sharePointer.identifier;
              const kindMatch = eventPointer.kind === sharePointer.kind;
              const pubkeyMatch = eventPointer.pubkey === sharePointer.pubkey;

              if (idMatch && kindMatch && pubkeyMatch) {
                const pTag = shareEvent.tags.find((t) => t[0] === 'p');
                if (pTag?.[1]) {
                  shares.add(pTag[1]);
                }
              }
            } else if (eTag && eTag[1] === event.id) {
              const pTag = shareEvent.tags.find((t) => t[0] === 'p');
              if (pTag?.[1]) {
                shares.add(pTag[1]);
              }
            }
          }
        }
        communitiesWithShares = shares;
        isCheckingShares = false;
      });

    return () => {
      repostLoaderSub.unsubscribe();
      legacyLoaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /**
   * Create a NIP-18 repost (kind 6/16) with h-tag for community targeting
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function createShare(communityPubkey) {
    const factory = new EventFactory({
      signer: activeUser.signer
    });

    // Use applesauce ShareBlueprint — creates kind 6 (for kind 1) or kind 16 (generic)
    // Auto-adds e, a, p, k tags with relay hints and embeds event as JSON
    const template = await factory.share(event);

    // Append h-tag for community targeting
    template.tags = [...template.tags, ['h', communityPubkey]];

    const signedEvent = await factory.sign(template);

    const result = await publishEvent(signedEvent, [communityPubkey]);

    if (result.success) {
      eventStore.add(signedEvent);
    }

    return result.success;
  }

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
            const success = await performDeletion(toDelete);
            resolve(success);
          } else {
            resolve(true); // Consider successful if already gone
          }
        });
    });
  }

  /**
   * Perform the actual deletion of a share event
   * @param {any} shareEvent
   * @returns {Promise<boolean>}
   */
  async function performDeletion(shareEvent) {
    const factory = new EventFactory({
      signer: activeUser.signer
    });

    const deleteEventTemplate = await factory.delete([shareEvent]);
    const deleteEvent = await factory.sign(deleteEventTemplate);

    const result = await publishEvent(deleteEvent);

    if (result.success) {
      eventStore.add(deleteEvent);
    }

    return result.success;
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
      for (const communityPubkey of selectedCommunityIds) {
        const isAlreadyShared = communitiesWithShares.has(communityPubkey);
        const communityName = getCommunityName(communityPubkey);

        try {
          let success = false;
          if (isAlreadyShared) {
            success = await deleteShare(communityPubkey);
          } else {
            success = await createShare(communityPubkey);
          }

          if (success) {
            shareResults.successful.push(communityName);
          } else {
            shareResults.failed.push(communityName);
          }
        } catch (error) {
          console.error(`CommunityShare: Failed to process share for ${communityPubkey}:`, error);
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
   * Select all communities that don't already have shares
   */
  function selectAllCommunities() {
    const availableCommunities = joinedCommunities.filter(
      (pubkey) => !communitiesWithShares.has(pubkey)
    );
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
          {@const isSelected = selectedCommunityIds.includes(communityPubKey)}
          {@const getCommunityProfile = useUserProfile(communityPubKey)}
          {@const communityProfile = getCommunityProfile()}
          <label class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-200">
            <input
              type="checkbox"
              class="checkbox checkbox-secondary {compact ? 'checkbox-sm' : ''}"
              checked={isSelected || isAlreadyShared}
              onchange={() => toggleCommunitySelection(communityPubKey)}
            />
            <span class="font-medium {compact ? 'text-sm' : ''}">
              {getDisplayName(communityProfile) ||
                `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
            </span>
            {#if isAlreadyShared && !isSelected}
              <span class="text-xs font-medium text-success">(Shared - click to unshare)</span>
            {:else if isAlreadyShared && isSelected}
              <span class="text-xs font-medium text-warning">(Will be unshared)</span>
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
