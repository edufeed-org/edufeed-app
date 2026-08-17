<script>
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    isDmConversationUnread,
    isUnlockingDms,
    getLockedCount,
    getKnownDmConversations,
    getDmRequestConversations,
    hasInitialDmsLoaded,
    markConversationAsRead
  } from '$lib/services/dm-service.svelte.js';
  import { muteUser } from '$lib/stores/mute-list.svelte.js';
  import { formatMessageTimestamp } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import UnreadDot from '$lib/components/shared/UnreadDot.svelte';
  import { ChevronDownIcon, ChevronUpIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   selectedConversationId?: string | null,
   *   onSelectConversation: (id: string, participants: string[]) => void,
   *   onNewMessage: () => void
   * }}
   */
  let { selectedConversationId = null, onSelectConversation, onNewMessage } = $props();

  const getActiveUser = useActiveUser();

  // Read conversations directly from the dm-service, which subscribes once at
  // login and keeps the classified lists populated module-wide. This avoids a
  // race where ConversationList's own subscription would mount before the
  // applesauce model had cached its first emission for this navigation.
  let conversations = $derived(getKnownDmConversations());
  let requests = $derived(getDmRequestConversations());
  let hasInitialLoad = $derived(hasInitialDmsLoaded());
  let isLoading = $derived(!hasInitialLoad || isUnlockingDms() || getLockedCount() > 0);

  // Requests stay collapsed until opened — spam shouldn't shout.
  let requestsExpanded = $state(false);
  let blockError = $state(false);

  // Collect all participant pubkeys for profile loading
  const getProfiles = useProfileMap(() => {
    const user = getActiveUser();
    /** @type {string[]} */
    const pubkeys = [];
    for (const conv of [...conversations, ...requests]) {
      for (const p of conv.participants) {
        if (p !== user?.pubkey && !pubkeys.includes(p)) pubkeys.push(p);
      }
    }
    return pubkeys;
  });
  let profiles = $derived(getProfiles());

  /**
   * Get display name for the "other" participants in a conversation.
   * @param {string[]} participants
   * @returns {string}
   */
  function getConversationName(participants) {
    const user = getActiveUser();
    const others = participants.filter((p) => p !== user?.pubkey);
    if (others.length === 0) return m.dm_self_note();
    return others
      .map((p) => {
        const profile = profiles.get(p);
        return profile?.display_name || profile?.name || p.slice(0, 8) + '...';
      })
      .join(', ');
  }

  /**
   * Get the primary "other" pubkey for avatar display.
   * @param {string[]} participants
   * @returns {string}
   */
  function getOtherPubkey(participants) {
    const user = getActiveUser();
    return participants.find((p) => p !== user?.pubkey) || participants[0] || '';
  }

  /** @param {string} pubkey */
  async function blockSender(pubkey) {
    blockError = false;
    try {
      await muteUser(pubkey);
    } catch (err) {
      console.error('[dm] failed to mute sender:', err);
      blockError = true;
    }
  }
</script>

{#snippet conversationRow(/** @type {any} */ conv, /** @type {boolean} */ isRequest)}
  {@const otherPubkey = getOtherPubkey(conv.participants)}
  {@const unread = isDmConversationUnread(conv.id, conv.lastMessage.created_at)}
  <button
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-base-200
      {selectedConversationId === conv.id ? 'bg-base-200' : ''}"
    onclick={() => onSelectConversation(conv.id, conv.participants)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div onclick={(e) => e.stopPropagation()}>
      <ProfileAvatar
        pubkey={otherPubkey}
        profile={profiles.get(otherPubkey)}
        size="sm"
        linkToProfile
        showHoverCard
      />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between">
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            class="truncate font-medium {unread ? 'text-base-content' : 'text-base-content/80'}"
          >
            {getConversationName(conv.participants)}
          </span>
          {#if conv.legacy}
            <span
              class="badge shrink-0 badge-xs badge-warning"
              title={m.dm_legacy_insecure_banner()}
            >
              {m.dm_legacy_badge()}
            </span>
          {/if}
        </span>
        <span class="shrink-0 text-xs text-base-content/50">
          {formatMessageTimestamp(conv.lastMessage.created_at)}
        </span>
      </div>
      <p
        class="truncate text-sm {unread
          ? 'font-medium text-base-content/80'
          : 'text-base-content/50'}"
      >
        {conv.lastMessage.content}
      </p>
    </div>
    {#if isRequest}
      <!-- span role=button: a real <button> can't nest inside the row button -->
      <span
        role="button"
        tabindex="0"
        class="btn shrink-0 text-error btn-ghost btn-xs"
        title={m.dm_block_sender()}
        onclick={(e) => {
          e.stopPropagation();
          blockSender(otherPubkey);
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            blockSender(otherPubkey);
          }
        }}
      >
        {m.dm_block_sender()}
      </span>
    {:else if unread}
      <UnreadDot onclick={() => markConversationAsRead(conv.id, conv.lastMessage.created_at)} />
    {/if}
  </button>
{/snippet}

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3">
    <h2 class="text-lg font-bold">{m.dm_title()}</h2>
    <button class="btn btn-sm btn-primary" onclick={onNewMessage}>
      {m.dm_new_message()}
    </button>
  </div>

  <!-- Unlock progress -->
  {#if isUnlockingDms()}
    <div class="flex items-center gap-2 bg-base-200 px-4 py-2 text-sm text-base-content/70">
      <span class="loading loading-xs loading-spinner"></span>
      {m.dm_unlocking()}
    </div>
  {/if}

  {#if blockError}
    <div class="px-4 py-2 text-sm text-error">{m.dm_block_failed()}</div>
  {/if}

  <!-- Conversation list -->
  <div class="flex-1 overflow-y-auto">
    <!-- Message requests: strangers land here, collapsed and badge-silent -->
    {#if requests.length > 0}
      <button
        class="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium text-base-content/70 transition-colors hover:bg-base-200"
        onclick={() => (requestsExpanded = !requestsExpanded)}
        title={m.dm_requests_hint()}
      >
        <span>{m.dm_requests_title()} ({requests.length})</span>
        {#if requestsExpanded}
          <ChevronUpIcon class_="h-4 w-4" />
        {:else}
          <ChevronDownIcon class_="h-4 w-4" />
        {/if}
      </button>
      {#if requestsExpanded}
        <div class="border-b border-base-300">
          <p class="px-4 pb-1 text-xs text-base-content/50">{m.dm_requests_hint()}</p>
          {#each requests as conv (conv.id)}
            {@render conversationRow(conv, true)}
          {/each}
        </div>
      {/if}
    {/if}

    {#if conversations.length === 0 && requests.length === 0 && isLoading}
      <div
        class="flex flex-col items-center justify-center gap-2 py-12 text-center text-base-content/50"
      >
        <span class="loading loading-md loading-spinner"></span>
        <p>{m.dm_loading_messages()}</p>
      </div>
    {:else if conversations.length === 0 && requests.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center text-base-content/50">
        <p>{m.dm_no_conversations()}</p>
      </div>
    {:else}
      {#each conversations as conv (conv.id)}
        {@render conversationRow(conv, false)}
      {/each}
    {/if}
  </div>
</div>
