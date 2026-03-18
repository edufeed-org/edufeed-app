<script>
  import { useJoinedCommunitiesList } from '../../stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '../../stores/user-profile.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { publishEvent } from '$lib/services/publish-service.js';
  import {
    getDisplayName,
    getAddressPointerForEvent,
    getReplaceableIdentifier,
    getReplaceableAddress
  } from 'applesauce-core/helpers';
  import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
  import { PlusIcon, CheckIcon, AlertIcon } from '../icons';

  /**
   * @typedef {Object} Props
   * @property {any} event - Calendar event to share
   * @property {any} activeUser - Current active user
   * @property {boolean} [compact=false] - Use compact layout for dropdowns
   */

  /** @type {Props} */
  let { event, activeUser, compact = false } = $props();

  // Get joined communities
  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // State management
  let selectedCommunityIds = $state(/** @type {string[]} */ ([]));
  /** @type {Set<string>} */
  let communitiesWithShares = $state.raw(new Set());
  let isCheckingShares = $state(false);
  let isProcessingCommunityShares = $state(false);
  let communityShareError = $state('');
  let communityShareSuccess = $state('');
  let communityShareResults = $state({
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
   * Check which communities already have sharing events for this calendar event
   * Uses loader/model pattern with proper deduplication and cleanup
   */
  $effect(() => {
    if (!activeUser || !event || !joinedCommunities.length) {
      communitiesWithShares = new Set();
      isCheckingShares = false;
      return;
    }

    isCheckingShares = true;

    // Subscribe to all share events for this user
    // Recompute full shares set on each emission
    const modelSub = eventStore
      .timeline({
        kinds: [30222],
        authors: [activeUser.pubkey]
      })
      .subscribe((shareEvents) => {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw, not reactive
        const shares = new Set();
        for (const shareEvent of shareEvents || []) {
          // Check if this share references our event
          const aTag = shareEvent.tags.find((t) => t[0] === 'a');
          if (aTag) {
            const eventPointer = getAddressPointerForEvent(event.originalEvent);
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
          }
        }
        communitiesWithShares = shares;
        isCheckingShares = false;
      });

    return () => {
      modelSub.unsubscribe();
    };
  });

  /**
   * Create a community sharing event (kind 30222)
   * Uses addressable event reference ('a' tag) instead of event ID ('e' tag)
   * This ensures the share continues to work even when the event is edited
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function createCommunityShare(communityPubkey) {
    const eventAddress = getReplaceableAddress(event.originalEvent);
    if (!eventAddress) {
      throw new Error('Cannot create share: event address invalid');
    }

    // Create EventFactory for the user
    const factory = new EventFactory({
      signer: activeUser.signer
    });

    // Generate d-tag based on event address (not event ID)
    const dTag = getReplaceableIdentifier(event.originalEvent);

    console.log(`🌐 CommunityCalendarShare: Creating share event with d-tag: ${dTag}`);

    // Create the sharing event with both 'a' and 'e' tags
    // 'a' tag (addressable reference) ensures share survives event edits
    // 'e' tag (event ID) included for backward compatibility
    const shareEvent = await factory.build({
      kind: 30222,
      tags: [
        ['d', dTag],
        ['a', eventAddress], // Addressable reference (persistent across edits)
        ['e', event.id], // Event ID (for backward compatibility)
        ['k', event.kind.toString()],
        ['p', communityPubkey]
      ]
    });

    // Sign the event
    const signedEvent = await factory.sign(shareEvent);

    console.log(
      `🌐 CommunityCalendarShare: Publishing share using outbox model + communikey relays`
    );

    // Publish using outbox model + communikey relays (for kind 30222)
    const result = await publishEvent(signedEvent, [communityPubkey]);

    if (result.success) {
      // Add to event store immediately for local update
      eventStore.add(signedEvent);
      console.log('✅ CommunityCalendarShare: Share created successfully');
    } else {
      console.error('❌ CommunityCalendarShare: Share creation failed');
    }

    return result.success;
  }

  /**
   * Delete a community sharing event
   * Tries multiple lookup strategies to handle different share event formats
   * @param {string} communityPubkey
   * @returns {Promise<boolean>}
   */
  async function deleteCommunityShare(communityPubkey) {
    console.log(
      `🌐 CommunityCalendarShare: Deleting share for community ${communityPubkey.slice(0, 8)}...`
    );

    if (!activeUser || !event) {
      throw new Error('Missing user or event data');
    }

    // Strategy 1: Try lookup by calendar event's d-tag (current format)
    const calendarDTag = getReplaceableIdentifier(event.originalEvent);

    return new Promise((resolve) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;
      sub = eventStore
        .replaceable({
          kind: 30222,
          pubkey: activeUser.pubkey,
          identifier: calendarDTag
        })
        .subscribe(async (shareEvent) => {
          if (sub) sub.unsubscribe();

          // If found with current format, delete it
          if (shareEvent) {
            console.log('🌐 CommunityCalendarShare: Found share with current format (d-tag)');
            const success = await performShareDeletion(shareEvent);
            resolve(success);
            return;
          }

          // Strategy 2: Try lookup by calendar event ID (legacy format)
          console.log('🌐 CommunityCalendarShare: Trying legacy format lookup (event ID)...');
          /** @type {import('rxjs').Subscription | undefined} */
          let legacySub;
          legacySub = eventStore
            .replaceable({
              kind: 30222,
              pubkey: activeUser.pubkey,
              identifier: event.id
            })
            .subscribe(async (legacyShareEvent) => {
              if (legacySub) legacySub.unsubscribe();

              if (legacyShareEvent) {
                console.log('🌐 CommunityCalendarShare: Found share with legacy format (event ID)');
                const success = await performShareDeletion(legacyShareEvent);
                resolve(success);
                return;
              }

              // Strategy 3: Query all user's shares and find by tags
              console.log('🌐 CommunityCalendarShare: Trying manual search through all shares...');
              /** @type {import('rxjs').Subscription | undefined} */
              let allSharesSub;
              allSharesSub = eventStore
                .timeline({
                  kinds: [30222],
                  authors: [activeUser.pubkey]
                })
                .subscribe(async (allShares) => {
                  if (allSharesSub) allSharesSub.unsubscribe();

                  // Find share that references this community and event
                  const matchingShare = allShares.find((share) => {
                    const pTag = share.tags.find((t) => t[0] === 'p');
                    const eTag = share.tags.find((t) => t[0] === 'e');
                    const aTag = share.tags.find((t) => t[0] === 'a');

                    const matchesCommunity = pTag?.[1] === communityPubkey;
                    const matchesEventId = eTag?.[1] === event.id;
                    const matchesEventAddress =
                      aTag?.[1] === getReplaceableAddress(event.originalEvent);

                    return matchesCommunity && (matchesEventId || matchesEventAddress);
                  });

                  if (matchingShare) {
                    console.log('🌐 CommunityCalendarShare: Found share through manual search');
                    const success = await performShareDeletion(matchingShare);
                    resolve(success);
                  } else {
                    console.warn(
                      `🌐 CommunityCalendarShare: No share event found for community ${communityPubkey} after all lookup strategies`
                    );
                    resolve(true); // Consider it successful if already gone
                  }
                });
            });
        });
    });
  }

  /**
   * Perform the actual deletion of a share event
   * @param {any} shareEvent - The share event to delete
   * @returns {Promise<boolean>}
   */
  async function performShareDeletion(shareEvent) {
    console.log('🌐 CommunityCalendarShare: Creating deletion event for share:', shareEvent.id);

    // Create EventFactory for deletion
    const factory = new EventFactory({
      signer: activeUser.signer
    });

    // Create deletion event (kind 5)
    const deleteEventTemplate = await factory.delete([shareEvent]);

    // Sign the deletion event
    const deleteEvent = await factory.sign(deleteEventTemplate);

    // Publish deletion using outbox model
    const result = await publishEvent(deleteEvent);

    if (result.success) {
      // Add deletion event to EventStore immediately
      // This triggers EventStore's automatic deletion of referenced share events
      // and updates all subscriptions without waiting for relay roundtrip
      eventStore.add(deleteEvent);

      console.log('✅ CommunityCalendarShare: Share deleted successfully');
    } else {
      console.error('❌ CommunityCalendarShare: Share deletion failed');
    }

    return result.success;
  }

  /**
   * Handle applying community sharing changes
   */
  async function handleApplyCommunityShares() {
    if (selectedCommunityIds.length === 0 || !activeUser || !event) {
      console.log('🌐 CommunityCalendarShare: Nothing to apply');
      return;
    }

    isProcessingCommunityShares = true;
    communityShareError = '';
    communityShareSuccess = '';
    communityShareResults = { successful: [], failed: [] };

    console.log(`🌐 CommunityCalendarShare: Processing ${selectedCommunityIds.length} communities`);

    try {
      // Process each selected community
      for (const communityPubkey of selectedCommunityIds) {
        const isAlreadyShared = communitiesWithShares.has(communityPubkey);
        const communityName = getCommunityName(communityPubkey);

        try {
          let success = false;
          if (isAlreadyShared) {
            console.log(`🌐 CommunityCalendarShare: Removing share for "${communityName}"`);
            success = await deleteCommunityShare(communityPubkey);
          } else {
            console.log(`🌐 CommunityCalendarShare: Creating share for "${communityName}"`);
            success = await createCommunityShare(communityPubkey);
          }

          if (success) {
            communityShareResults.successful.push(communityName);
          } else {
            communityShareResults.failed.push(communityName);
          }
        } catch (error) {
          console.error(
            `🌐 CommunityCalendarShare: Failed to process community share for ${communityPubkey}:`,
            error
          );
          communityShareResults.failed.push(communityName);
        }
      }

      // Update success message
      const successfulCount = communityShareResults.successful.length;
      const failedCount = communityShareResults.failed.length;

      if (successfulCount > 0) {
        communityShareSuccess = `Successfully shared with ${successfulCount} community${successfulCount > 1 ? 'ies' : ''}`;
        if (failedCount > 0) {
          communityShareSuccess += `, failed for ${failedCount}`;
        }
      } else if (failedCount > 0) {
        communityShareError = `Failed to share with ${failedCount} community${failedCount > 1 ? 'ies' : ''}`;
      }

      // Reset selection
      selectedCommunityIds = [];

      console.log(
        `🌐 CommunityCalendarShare: Processing complete - ${successfulCount} successful, ${failedCount} failed`
      );
    } catch (error) {
      console.error('🌐 CommunityCalendarShare: Error applying community shares:', error);
      communityShareError =
        error instanceof Error ? error.message : 'Failed to apply community sharing changes';
    } finally {
      isProcessingCommunityShares = false;
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
    console.log('🌐 CommunityCalendarShare: Selected communities:', selectedCommunityIds);
  }

  /**
   * Select all communities that don't already have shares
   */
  function selectAllCommunities() {
    const availableCommunities = joinedCommunities.filter(
      (pubkey) => !communitiesWithShares.has(pubkey)
    );
    selectedCommunityIds = availableCommunities;
    console.log(
      '🌐 CommunityCalendarShare: Selected all available communities:',
      availableCommunities
    );
  }

  /**
   * Deselect all communities
   */
  function deselectAllCommunities() {
    selectedCommunityIds = [];
    console.log('🌐 CommunityCalendarShare: Deselected all communities');
  }
</script>

<!-- Community Sharing UI -->
<div class="community-calendar-share" class:compact>
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

  <!-- Apply Community Shares Button -->
  <div class="flex items-center gap-3">
    <button
      class="btn btn-secondary {compact ? 'btn-block btn-sm' : ''}"
      disabled={selectedCommunityIds.length === 0 || isProcessingCommunityShares}
      onclick={handleApplyCommunityShares}
    >
      {#if isProcessingCommunityShares}
        <span class="loading loading-spinner {compact ? 'loading-sm' : ''}"></span>
        Applying changes to {selectedCommunityIds.length} community{selectedCommunityIds.length > 1
          ? 'ies'
          : ''}...
      {:else}
        <PlusIcon class_="w-4 h-4 mr-2" />
        Apply Changes to {selectedCommunityIds.length || 'Selected'} Communit{selectedCommunityIds.length !==
        1
          ? 'ies'
          : 'y'}
      {/if}
    </button>
  </div>

  <!-- Community Share Success Message -->
  {#if communityShareSuccess}
    <div class="mt-3 alert alert-success {compact ? 'py-2' : ''}">
      <CheckIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{communityShareSuccess}</span>
    </div>
  {/if}

  <!-- Community Share Error Message -->
  {#if communityShareError}
    <div class="mt-3 alert alert-error {compact ? 'py-2' : ''}">
      <AlertIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{communityShareError}</span>
    </div>
  {/if}
</div>
