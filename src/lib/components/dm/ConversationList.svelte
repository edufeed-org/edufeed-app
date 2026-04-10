<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { WrappedMessagesGroups } from 'applesauce-common/models';
  import { isDmConversationUnread, isUnlockingDms } from '$lib/services/dm-service.svelte.js';
  import { formatMessageTimestamp } from '$lib/helpers/message-utils.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
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

  /** @type {{ id: string, participants: string[], lastMessage: any }[]} */
  let conversations = $state.raw([]);

  $effect(() => {
    const user = getActiveUser();
    if (!user) return;

    const sub = eventStore.model(WrappedMessagesGroups, user.pubkey).subscribe((convs) => {
      conversations = convs || [];
    });
    return () => sub.unsubscribe();
  });

  // Collect all participant pubkeys for profile loading
  const getProfiles = useProfileMap(() => {
    const user = getActiveUser();
    /** @type {string[]} */
    const pubkeys = [];
    for (const conv of conversations) {
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
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
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

  <!-- Conversation list -->
  <div class="flex-1 overflow-y-auto">
    {#if conversations.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-center text-base-content/50">
        <p>{m.dm_no_conversations()}</p>
      </div>
    {:else}
      {#each conversations as conv (conv.id)}
        {@const otherPubkey = getOtherPubkey(conv.participants)}
        {@const unread = isDmConversationUnread(conv.id, conv.lastMessage.created_at)}
        <button
          class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-base-200
            {selectedConversationId === conv.id ? 'bg-base-200' : ''}"
          onclick={() => onSelectConversation(conv.id, conv.participants)}
        >
          <ProfileAvatar pubkey={otherPubkey} profile={profiles.get(otherPubkey)} size="sm" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between">
              <span
                class="truncate font-medium {unread ? 'text-base-content' : 'text-base-content/80'}"
              >
                {getConversationName(conv.participants)}
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
          {#if unread}
            <span class="badge badge-xs badge-primary"></span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
