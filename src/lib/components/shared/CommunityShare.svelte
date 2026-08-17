<!--
  CommunityShare Component
  Reusable component for sharing any content type with communities using NIP-18 reposts (kind 6/16)
  with h-tag community targeting. Also detects legacy kind 30222 shares for backward compat.
-->

<script>
  // Share surfaces list joined ∪ area-linked communities — a private area's
  // member never (publicly) follow-set-joins, but must still be able to share.
  import { useShareableCommunities } from '$lib/concord/shareable-communities.svelte.js';
  import { useShareRestrictions } from '$lib/stores/share-restrictions.svelte.js';
  // Private in-group sharing: a member posts the content into the E2E area
  // (only members can decrypt; authorship member-verified by construction) —
  // the counterpart to the public window. Concord submodules imported
  // DIRECTLY, never the barrel (src/lib/concord convention).
  import { getConcordState } from '$lib/concord/client.svelte.js';
  import { useConcordArea } from '$lib/concord/community.svelte.js';
  import { sendChannelMessage } from '$lib/concord/send-message.js';
  import { nostrShareUri, memberAreaIdFor, shareableChannels } from '$lib/concord/private-share.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';
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
  import { buildShareResultMessages } from '$lib/helpers/shareMessages.js';
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
  const getJoinedCommunities = useShareableCommunities();
  const joinedCommunities = $derived(getJoinedCommunities());
  // Communities where this share would publish and then never render (the
  // section for this kind is profile-list gated and the user is not on the
  // list) — rows are disabled instead of letting the share vanish.
  const getRestricted = useShareRestrictions(
    () => event?.kind,
    () => joinedCommunities
  );

  // ── Private in-group share (channel picker) ──
  /** @param {string} communityPubkey */
  function privateAreaIdFor(communityPubkey) {
    if (!runtimeConfig.concord?.enabled) return null;
    return memberAreaIdFor(
      eventStore.getReplaceable(10222, communityPubkey),
      getConcordState().communities
    );
  }
  // Which community's picker is open (one at a time), and the chosen channel.
  let privateShareFor = $state(/** @type {string | null} */ (null));
  let privateChannelId = $state('');
  let privateSending = $state(false);
  const getPickerArea = useConcordArea(() =>
    privateShareFor ? (privateAreaIdFor(privateShareFor) ?? undefined) : undefined
  );

  /** @param {string} communityPubkey */
  function togglePrivateShare(communityPubkey) {
    privateShareFor = privateShareFor === communityPubkey ? null : communityPubkey;
    privateChannelId = '';
  }

  async function sendPrivateShare() {
    const area = getPickerArea();
    const channels = shareableChannels(area.channels);
    const channelId = privateChannelId || channels[0]?.channel_id;
    const uri = nostrShareUri(event);
    if (privateSending || !area.community || !channelId || !uri) return;
    privateSending = true;
    try {
      await sendChannelMessage(area.community, channelId, uri, null, activeUser?.pubkey);
      const channelName = channels.find((c) => c.channel_id === channelId)?.name ?? '';
      showToast(m.share_private_sent({ channel: channelName }), 'success');
      privateShareFor = null;
    } catch (error) {
      console.error('private share failed', error);
      showToast(m.share_private_failed(), 'error');
    } finally {
      privateSending = false;
    }
  }

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
    shared: /** @type {string[]} */ ([]),
    unshared: /** @type {string[]} */ ([]),
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

    // Detect ALL shares (NIP-18 reposts + legacy 30222, by any user) with ONE
    // loader carrying merged filters: relays enforce a per-connection REQ
    // budget, and this component used to burn 2-4 slots per mount (#18).
    const lookupRelays = [...new Set(getAllLookupRelays())];

    // For addressable events, also search by a-tag (some shares may only have a-tag)
    const isAddressable = event.kind >= 30000 && event.kind < 40000;
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const address = isAddressable ? `${event.kind}:${event.pubkey}:${dTag}` : null;

    /** @type {import('nostr-tools').Filter[]} */
    const shareFilters = [{ kinds: [6, 16, 30222], '#e': [event.id] }];
    if (address) {
      shareFilters.push({ kinds: [6, 16, 30222], '#a': [address] });
    }

    const shareLoader = createTimelineLoader(pool, lookupRelays, shareFilters, {
      eventStore,
      limit: 50
    });
    const shareLoaderSub = shareLoader().subscribe({
      error: (err) => console.warn('CommunityShare: Share loader error:', err)
    });

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
      shareLoaderSub.unsubscribe();
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
    shareResults = { shared: [], unshared: [], failed: [] };

    try {
      // Separate into creates vs deletes (only deletable shares can be unshared)
      const toCreate = selectedCommunityIds.filter((id) => !deletableShares.has(id));
      const toDelete = selectedCommunityIds.filter((id) => deletableShares.has(id));

      // Batch create: ONE sign call for all new shares
      if (toCreate.length > 0) {
        try {
          const success = await createCommunityReposts(event, toCreate, activeUser.signer);
          if (success) {
            for (const id of toCreate) shareResults.shared.push(getCommunityName(id));
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
            shareResults.unshared.push(communityName);
          } else {
            shareResults.failed.push(communityName);
          }
        } catch (error) {
          console.error(`CommunityShare: Failed to delete share for ${communityPubkey}:`, error);
          shareResults.failed.push(communityName);
        }
      }

      const messages = buildShareResultMessages({
        shared: shareResults.shared.length,
        unshared: shareResults.unshared.length,
        failed: shareResults.failed.length
      });
      shareSuccess = messages.success;
      shareError = messages.error;

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
          {@const isRestricted = getRestricted().has(communityPubKey)}
          {@const getCommunityProfile = useUserProfile(communityPubKey)}
          {@const communityProfile = getCommunityProfile()}
          <label
            class="flex items-center gap-3 rounded p-2 {isRestricted
              ? 'opacity-50'
              : 'cursor-pointer hover:bg-base-200'}"
            title={isRestricted ? m.share_restricted_hint() : undefined}
          >
            <!-- The checkbox shows the RESULTING state: shared communities are
                 checked; selecting a deletable share (pending unshare) unchecks
                 it, selecting an unshared one checks it. -->
            <input
              type="checkbox"
              class="checkbox checkbox-secondary {compact ? 'checkbox-sm' : ''}"
              checked={isDeletable ? !isSelected : isAlreadyShared || isSelected}
              disabled={isProcessingShares || isRestricted}
              onchange={() => toggleCommunitySelection(communityPubKey)}
            />
            <span class="font-medium {compact ? 'text-sm' : ''}">
              {getDisplayName(communityProfile) ||
                `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
            </span>
            {#if isRestricted}
              <span class="text-xs text-base-content/60" data-testid="share-restricted-badge"
                >🔒 {m.share_restricted_label()}</span
              >
            {/if}
            {#if isDeletable && isSelected}
              <span class="text-xs font-medium text-warning">(Will be unshared)</span>
            {:else if isDeletable}
              <span class="text-xs font-medium text-success">(Shared - click to unshare)</span>
            {:else if isNonDeletable}
              <span class="text-xs font-medium text-success/70">(Shared by others)</span>
            {:else if isSelected}
              <span class="text-xs font-medium text-info">(Will be shared)</span>
            {/if}
            {#if privateAreaIdFor(communityPubKey)}
              <button
                type="button"
                class="btn ml-auto shrink-0 btn-ghost btn-xs"
                data-testid="share-private-toggle"
                title={m.share_private_hint()}
                onclick={(/** @type {Event} */ e) => {
                  e.preventDefault();
                  togglePrivateShare(communityPubKey);
                }}
              >
                🔒 {m.share_private_action()}
              </button>
            {/if}
          </label>
          {#if privateShareFor === communityPubKey}
            {@const pickerChannels = shareableChannels(getPickerArea().channels)}
            <div
              class="mt-1 mb-2 ml-9 flex flex-wrap items-center gap-2"
              data-testid="share-private-picker"
            >
              <span class="text-xs text-base-content/60">{m.share_private_channel_label()}</span>
              <!-- Explicit value (not bind): the channel list arrives async,
                so an empty bound value rendered a blank select — the shown
                value falls back to the first channel, matching what
                sendPrivateShare() sends when nothing was picked. -->
              <select
                class="select w-40 select-xs"
                value={privateChannelId || pickerChannels[0]?.channel_id}
                onchange={(/** @type {any} */ e) => (privateChannelId = e.currentTarget.value)}
                data-testid="share-private-channel"
              >
                {#each pickerChannels as channel (channel.channel_id)}
                  <option value={channel.channel_id}
                    ># {channel.name ?? channel.channel_id.slice(0, 8)}</option
                  >
                {/each}
              </select>
              <button
                class="btn btn-xs btn-primary"
                data-testid="share-private-send"
                disabled={privateSending || pickerChannels.length === 0}
                onclick={sendPrivateShare}
              >
                {#if privateSending}<span class="loading loading-xs loading-spinner"></span>{/if}
                {m.share_private_send()}
              </button>
              <span class="w-full text-xs text-base-content/50">{m.share_private_hint()}</span>
            </div>
          {/if}
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
