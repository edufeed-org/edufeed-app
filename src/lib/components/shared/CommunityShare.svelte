<!--
  CommunityShare Component
  Reusable component for sharing any content type with communities using kind 30222 targeted publications
  Follows the Communikey NIP pattern for targeted content sharing
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
    getReplaceableIdentifier,
    getReplaceableAddress
  } from 'applesauce-core/helpers';
  import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
  import { PlusIcon, CheckIcon, AlertIcon } from '../icons';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';

  /**
   * @typedef {Object} Props
   * @property {any} event - Event to share (any kind: calendar, article, etc.)
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
   * Note: We use truncated pubkey here instead of profile lookup because
   * useUserProfile() uses $effect internally which cannot be called from async handlers
   * @param {string} communityPubkey
   * @returns {string}
   */
  function getCommunityName(communityPubkey) {
    return communityPubkey.slice(0, 8) + '...';
  }

  /**
   * Check which communities already have sharing events for this content
   * Uses loader/model pattern with proper deduplication and cleanup
   */
  $effect(() => {
    if (!activeUser || !event || !joinedCommunities.length) {
      communitiesWithShares = new Set();
      isCheckingShares = false;
      return;
    }

    isCheckingShares = true;

    // Create loader to FETCH user's targeted publications from relays
    const loader = createTimelineLoader(
      pool,
      runtimeConfig.fallbackRelays || [],
      {
        kinds: [30222],
        authors: [activeUser.pubkey]
      },
      { eventStore, limit: 100 }
    );

    // Start fetching from relays
    const loaderSub = loader().subscribe({
      error: (err) => console.warn('🔗 CommunityShare: Loader error:', err)
    });

    // Subscribe to EventStore for reactive updates
    // Recompute full shares set on each emission (TimelineModel emits the complete list)
    const modelSub = eventStore
      .model(TimelineModel, {
        kinds: [30222],
        authors: [activeUser.pubkey]
      })
      .subscribe((shareEvents) => {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw, not reactive
        const shares = new Set();
        for (const shareEvent of shareEvents || []) {
          // Check if this share references our event
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
        communitiesWithShares = shares;
        isCheckingShares = false;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /**
   * Create a community sharing event (kind 30222)
   * Uses addressable event reference ('a' tag) for replaceable events
   * Uses event ID ('e' tag) for non-replaceable events
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function createShare(communityPubkey) {
    const factory = new EventFactory({
      signer: activeUser.signer
    });

    // Determine if this is a replaceable event (kinds 30000-39999)
    const isReplaceable = event.kind >= 30000 && event.kind < 40000;

    // Generate tags based on event type
    const tags = [
      ['d', isReplaceable ? getReplaceableIdentifier(event) : event.id],
      ['k', event.kind.toString()],
      ['p', communityPubkey]
    ];

    // Add appropriate reference tag
    if (isReplaceable) {
      const eventAddress = getReplaceableAddress(event);
      if (eventAddress) {
        tags.push(['a', eventAddress]); // Addressable reference (persistent across edits)
        tags.push(['e', event.id]); // Also include event ID for compatibility
      }
    } else {
      tags.push(['e', event.id]); // Regular event ID reference
    }

    console.log(`🔗 CommunityShare: Creating share event with tags:`, tags);

    // Create and sign the sharing event
    const shareEvent = await factory.build({ kind: 30222, tags });
    const signedEvent = await factory.sign(shareEvent);

    console.log(`🔗 CommunityShare: Publishing share using outbox model + communikey relays`);

    // Publish using outbox model + communikey relays (for kind 30222)
    const result = await publishEvent(signedEvent, [communityPubkey]);

    if (result.success) {
      eventStore.add(signedEvent);
      console.log('✅ CommunityShare: Share created successfully');
    } else {
      console.error('❌ CommunityShare: Share creation failed');
    }

    return result.success;
  }

  /**
   * Delete a community sharing event
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function deleteShare(communityPubkey) {
    console.log(
      `🔗 CommunityShare: Deleting share for community ${communityPubkey.slice(0, 8)}...`
    );

    if (!activeUser || !event) {
      throw new Error('Missing user or event data');
    }

    // Determine identifier based on event type
    const isReplaceable = event.kind >= 30000 && event.kind < 40000;
    const identifier = isReplaceable ? getReplaceableIdentifier(event) : event.id;

    return new Promise((resolve) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;
      sub = eventStore
        .replaceable({
          kind: 30222,
          pubkey: activeUser.pubkey,
          identifier: identifier
        })
        .subscribe(async (shareEvent) => {
          if (sub) sub.unsubscribe();

          if (shareEvent) {
            console.log('🔗 CommunityShare: Found share event, creating deletion');
            const success = await performDeletion(shareEvent);
            resolve(success);
          } else {
            // Try manual search through all shares
            console.log('🔗 CommunityShare: Trying manual search...');
            /** @type {import('rxjs').Subscription | undefined} */
            let allSharesSub;
            allSharesSub = eventStore
              .timeline({
                kinds: [30222],
                authors: [activeUser.pubkey]
              })
              .subscribe(async (allShares) => {
                if (allSharesSub) allSharesSub.unsubscribe();

                const matchingShare = allShares.find((share) => {
                  const pTag = share.tags.find((t) => t[0] === 'p');
                  const eTag = share.tags.find((t) => t[0] === 'e');
                  const aTag = share.tags.find((t) => t[0] === 'a');

                  const matchesCommunity = pTag?.[1] === communityPubkey;
                  const matchesEventId = eTag?.[1] === event.id;
                  const matchesEventAddress =
                    isReplaceable && aTag?.[1] === getReplaceableAddress(event);

                  return matchesCommunity && (matchesEventId || matchesEventAddress);
                });

                if (matchingShare) {
                  console.log('🔗 CommunityShare: Found share through manual search');
                  const success = await performDeletion(matchingShare);
                  resolve(success);
                } else {
                  console.warn(
                    `🔗 CommunityShare: No share event found for community ${communityPubkey}`
                  );
                  resolve(true); // Consider successful if already gone
                }
              });
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
    console.log('🔗 CommunityShare: Creating deletion event for share:', shareEvent.id);

    const factory = new EventFactory({
      signer: activeUser.signer
    });

    const deleteEventTemplate = await factory.delete([shareEvent]);
    const deleteEvent = await factory.sign(deleteEventTemplate);

    // Publish deletion using outbox model
    const result = await publishEvent(deleteEvent);

    if (result.success) {
      eventStore.add(deleteEvent);
      console.log('✅ CommunityShare: Share deleted successfully');
    } else {
      console.error('❌ CommunityShare: Share deletion failed');
    }

    return result.success;
  }

  /**
   * Handle applying community sharing changes
   */
  async function handleApplyShares() {
    if (selectedCommunityIds.length === 0 || !activeUser || !event) {
      console.log('🔗 CommunityShare: Nothing to apply');
      return;
    }

    isProcessingShares = true;
    shareError = '';
    shareSuccess = '';
    shareResults = { successful: [], failed: [] };

    console.log(`🔗 CommunityShare: Processing ${selectedCommunityIds.length} communities`);

    try {
      for (const communityPubkey of selectedCommunityIds) {
        const isAlreadyShared = communitiesWithShares.has(communityPubkey);
        const communityName = getCommunityName(communityPubkey);

        try {
          let success = false;
          if (isAlreadyShared) {
            console.log(`🔗 CommunityShare: Removing share for "${communityName}"`);
            success = await deleteShare(communityPubkey);
          } else {
            console.log(`🔗 CommunityShare: Creating share for "${communityName}"`);
            success = await createShare(communityPubkey);
          }

          if (success) {
            shareResults.successful.push(communityName);
          } else {
            shareResults.failed.push(communityName);
          }
        } catch (error) {
          console.error(
            `🔗 CommunityShare: Failed to process share for ${communityPubkey}:`,
            error
          );
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

      console.log(
        `🔗 CommunityShare: Processing complete - ${successfulCount} successful, ${failedCount} failed`
      );
    } catch (error) {
      console.error('🔗 CommunityShare: Error applying shares:', error);
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
