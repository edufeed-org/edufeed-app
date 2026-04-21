<script>
  import { resolve } from '$app/paths';
  import { markConversationAsRead } from '$lib/services/dm-service.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { MessageSquareIcon } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import UnreadDot from '$lib/components/shared/UnreadDot.svelte';
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @type {{
   *   conversation: { id: string, participants: string[], lastMessage: any },
   *   profile?: any,
   *   unread: boolean
   * }}
   */
  let { conversation, profile, unread } = $props();

  const getActiveUser = useActiveUser();

  const otherPubkey = $derived.by(() => {
    const user = getActiveUser();
    return (
      conversation.participants.find((p) => p !== user?.pubkey) ||
      conversation.participants[0] ||
      ''
    );
  });

  const displayName = $derived(
    profile?.display_name || profile?.name || otherPubkey.slice(0, 8) + '...'
  );

  /**
   * @param {number} ts
   * @returns {string}
   */
  function formatTime(ts) {
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
</script>

<a
  href={resolve(`/c/messages?to=${otherPubkey}`)}
  data-sveltekit-preload-data="hover"
  class="flex w-full items-start gap-3 px-4 py-3 text-left no-underline transition-colors hover:bg-base-200/50
    {unread
    ? 'border-l-3 border-primary bg-primary/5'
    : 'border-l-3 border-transparent opacity-60'}"
  onclick={() => {
    if (unread) {
      markConversationAsRead(conversation.id, conversation.lastMessage.created_at);
    }
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="mt-0.5 flex-shrink-0" onclick={(e) => e.stopPropagation()}>
    {#if profile}
      <ProfileAvatar pubkey={otherPubkey} {profile} size="sm" linkToProfile />
    {:else}
      <div class="flex h-9 w-9 items-center justify-center rounded-full bg-base-300">
        <MessageSquareIcon class_="h-4 w-4 text-base-content/50" />
      </div>
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <div class="text-sm leading-snug">
      <span class="font-medium">{displayName}</span>
      &nbsp;{m.inbox_action_dm()}
    </div>
    <div class="mt-0.5 flex items-center gap-2">
      <span class="text-xs text-base-content/50"
        >{formatTime(conversation.lastMessage.created_at)}</span
      >
    </div>
    {#if conversation.lastMessage.content}
      <p class="mt-0.5 truncate text-xs text-base-content/50">
        {conversation.lastMessage.content}
      </p>
    {/if}
  </div>
  {#if unread}
    <UnreadDot
      onclick={() => markConversationAsRead(conversation.id, conversation.lastMessage.created_at)}
    />
  {/if}
</a>
