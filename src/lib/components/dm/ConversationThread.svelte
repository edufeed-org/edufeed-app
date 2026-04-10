<script>
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { WrappedMessagesGroup } from 'applesauce-common/models';
  import { getWrappedMessageParent } from 'applesauce-common/helpers/wrapped-messages';
  import { SendWrappedMessage, ReplyToWrappedMessage } from 'applesauce-actions/actions';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { markConversationAsRead } from '$lib/services/dm-service.svelte.js';
  import {
    formatMessageTimestamp,
    getUserDisplayName as getDisplayName,
    groupMessagesByDate,
    reconcilePendingMessages
  } from '$lib/helpers/message-utils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { swipeable } from '$lib/helpers/swipe.js';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import { SmilePlusIcon, SendIcon, ReplyIcon, ChevronLeftIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   conversationId: string,
   *   participants: string[],
   *   onBack?: () => void
   * }}
   */
  let { conversationId, participants, onBack } = $props();

  const getActiveUser = useActiveUser();

  // Message state
  /** @type {any[]} */
  let messages = $state.raw([]);
  let newMessage = $state('');
  let isSending = $state(false);
  let showEmojiPicker = $state(false);
  /** @type {any} */
  let replyingTo = $state(null);
  /** @type {HTMLInputElement | undefined} */
  let messageInput = $state(undefined);

  // Optimistic (pending) messages shown before gift wrap publish completes
  /** @type {{ id: string, content: string, created_at: number, pubkey: string, status: 'sending' | 'sent' | 'failed' }[]} */
  let pendingMessages = $state([]);

  // Custom emoji state
  const getUserEmojiSets = useUserEmojiSets();
  let customEmojiSets = $derived(getUserEmojiSets());
  /** @type {Record<string, { shortcode: string, url: string }>} */
  let usedCustomEmojis = {};

  // Track last-marked timestamp to avoid redundant markConversationAsRead calls
  // (plain let, not $state, to avoid reactive tracking)
  let lastMarkedTimestamp = 0;

  // Subscribe to conversation messages
  $effect(() => {
    const user = getActiveUser();
    if (!user || !conversationId) return;

    lastMarkedTimestamp = 0; // Reset on conversation switch
    pendingMessages = []; // Clear pending on conversation switch

    const sub = eventStore
      .model(WrappedMessagesGroup, user.pubkey, participants)
      .subscribe((msgs) => {
        // WrappedMessagesGroup returns newest-first, we need oldest-first
        messages = (msgs || []).toReversed();
        // Reconcile optimistic messages against real ones.
        // Use untrack to avoid adding pendingMessages as a dependency of this $effect,
        // which would cause effect_update_depth_exceeded on rapid emissions.
        const pending = untrack(() => pendingMessages);
        if (pending.length > 0) {
          pendingMessages = reconcilePendingMessages(pending, messages);
        }
      });

    return () => sub.unsubscribe();
  });

  // Mark conversation as read when messages load or update
  $effect(() => {
    if (messages.length > 0 && conversationId) {
      const latestTimestamp = messages[messages.length - 1]?.created_at;
      if (latestTimestamp && latestTimestamp > lastMarkedTimestamp) {
        lastMarkedTimestamp = latestTimestamp;
        markConversationAsRead(conversationId, latestTimestamp);
      }
    }
  });

  // Profile loading for participants + message authors
  const getProfiles = useProfileMap(() => [...participants, ...messages.map((msg) => msg.pubkey)]);
  let userProfiles = $derived(getProfiles());

  // Group messages by date
  let groupedMessages = $derived(groupMessagesByDate(messages));

  /** @param {string} pubkey */
  function getUserDisplayName(pubkey) {
    return getDisplayName(pubkey, userProfiles.get(pubkey));
  }

  // Auto-scroll
  /** @type {HTMLElement} */
  let chatContainer;
  let prevMessageCount = 0;
  $effect(() => {
    const totalCount = messages.length + pendingMessages.length;
    if (chatContainer && totalCount > 0) {
      const isNewMessage = totalCount > prevMessageCount;
      const isNearBottom =
        chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
      if (prevMessageCount === 0 || (isNewMessage && isNearBottom)) {
        requestAnimationFrame(() => {
          if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
        });
      }
      prevMessageCount = totalCount;
    }
  });

  /** @param {Event} event */
  async function sendMessage(event) {
    event.preventDefault();

    const user = getActiveUser();
    if (!user || !newMessage.trim()) return;

    const content = newMessage.trim();
    newMessage = '';
    isSending = true;

    // Add optimistic message immediately
    const optimisticId = crypto.randomUUID();
    pendingMessages = [
      ...pendingMessages,
      {
        id: optimisticId,
        content,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: user.pubkey,
        status: /** @type {const} */ ('sending')
      }
    ];

    try {
      if (replyingTo) {
        await actionRunner.run(ReplyToWrappedMessage, replyingTo, content);
      } else {
        await actionRunner.run(SendWrappedMessage, participants, content);
      }
      // Mark as sent — will be reconciled when real event arrives
      pendingMessages = pendingMessages.map((p) =>
        p.id === optimisticId ? { ...p, status: /** @type {const} */ ('sent') } : p
      );
      replyingTo = null;
      usedCustomEmojis = {};
    } catch (err) {
      console.error('Failed to send DM:', err);
      pendingMessages = pendingMessages.map((p) =>
        p.id === optimisticId ? { ...p, status: /** @type {const} */ ('failed') } : p
      );
      newMessage = content;
      showToast(m.dm_send_failed(), 'error');
    } finally {
      isSending = false;
    }
  }

  /** @param {string} emoji */
  function insertEmoji(emoji) {
    newMessage += emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  /** @param {{ shortcode: string, url: string }} emoji */
  function insertCustomEmoji(emoji) {
    newMessage += `:${emoji.shortcode}:`;
    usedCustomEmojis[emoji.shortcode] = emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  /**
   * Get the conversation display name (other participants).
   * @returns {string}
   */
  function getHeaderName() {
    const user = getActiveUser();
    const others = participants.filter((p) => p !== user?.pubkey);
    if (others.length === 0) return m.dm_self_note();
    return others.map((p) => getDisplayName(p, userProfiles.get(p))).join(', ');
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- Thread header -->
  <div class="flex items-center gap-2 border-b border-base-300 px-4 py-3">
    {#if onBack}
      <button class="btn btn-circle btn-ghost btn-sm" onclick={onBack}>
        <ChevronLeftIcon class_="h-5 w-5" />
      </button>
    {/if}
    <h3 class="truncate font-bold">{getHeaderName()}</h3>
  </div>

  <!-- Messages -->
  <div bind:this={chatContainer} class="flex-1 space-y-1 overflow-y-auto px-4 py-2">
    {#if messages.length === 0}
      <div class="py-8 text-center text-base-content/50">
        {m.dm_no_messages()}
      </div>
    {:else}
      {#each groupedMessages as item, i (item.type === 'separator' ? `sep-${item.date}-${i}` : item.message.id)}
        {#if item.type === 'separator'}
          <div class="divider text-xs text-base-content/40">{item.date}</div>
        {:else}
          {@const message = item.message}
          {@const isOwnMessage = getActiveUser() && message.pubkey === getActiveUser()?.pubkey}
          {@const parentId = getWrappedMessageParent(message)}
          <div
            class="group chat {isOwnMessage ? 'chat-end' : 'chat-start'}"
            use:swipeable={{
              onSwipe: () => {
                replyingTo = message;
                messageInput?.focus();
              },
              direction: isOwnMessage ? 'left' : 'right'
            }}
          >
            {#if !isOwnMessage}
              <ProfileAvatar
                pubkey={message.pubkey}
                profile={userProfiles.get(message.pubkey)}
                size="sm"
                linkToProfile
                class="chat-image"
              />
            {/if}

            <div class="chat-header mb-1 flex items-center gap-1 text-xs opacity-70">
              {#if !isOwnMessage}
                <a href={resolve(`/p/${message.pubkey}`)} class="font-semibold hover:underline">
                  {getUserDisplayName(message.pubkey)}
                </a>
                <span>&middot;</span>
              {/if}
              <time datetime={new Date(message.created_at * 1000).toISOString()}>
                {formatMessageTimestamp(message.created_at)}
              </time>
              <button
                type="button"
                onclick={() => {
                  replyingTo = message;
                  messageInput?.focus();
                }}
                class="ml-1 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100"
                title="Reply"
              >
                <ReplyIcon class="h-3.5 w-3.5" />
              </button>
            </div>

            <div class="chat-bubble {isOwnMessage ? 'chat-bubble-primary' : ''}">
              {#if parentId}
                {@const parent = messages.find((msg) => msg.id === parentId)}
                {#if parent}
                  <div
                    class="mb-1 rounded border-l-2 border-primary/40 bg-base-300/50 px-2 py-1 text-xs text-base-content/70"
                  >
                    <span class="font-semibold">{getUserDisplayName(parent.pubkey)}</span>
                    <p class="truncate">{parent.content}</p>
                  </div>
                {/if}
              {/if}
              <NostrContentRenderer event={message} />
            </div>
          </div>
        {/if}
      {/each}
    {/if}

    {#each pendingMessages as pending (pending.id)}
      <div class="chat-end chat">
        <div
          class="chat-bubble chat-bubble-primary {pending.status === 'failed'
            ? 'opacity-50'
            : 'opacity-70'}"
        >
          {pending.content}
          {#if pending.status === 'sending'}
            <span class="loading ml-1 loading-xs loading-dots align-middle"></span>
          {:else if pending.status === 'failed'}
            <button
              type="button"
              class="ml-1 text-xs text-error underline"
              onclick={() => {
                pendingMessages = pendingMessages.filter((p) => p.id !== pending.id);
                newMessage = pending.content;
                messageInput?.focus();
              }}
            >
              ✕
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Spacer for fixed input on mobile -->
  <div class="h-28 shrink-0 lg:hidden"></div>

  <!-- Input: fixed on mobile (above tab bar), relative on desktop -->
  <div
    class="fixed right-0 bottom-[4.5rem] left-0 z-40 bg-base-100 px-4 pt-2 pb-2 lg:relative lg:bottom-auto lg:z-auto lg:bg-transparent lg:pb-4"
  >
    {#if showEmojiPicker}
      <div
        class="absolute bottom-full left-4 z-10 mb-2 flex max-h-80 w-72 flex-col rounded-lg bg-base-200 shadow-xl"
      >
        <EmojiPicker onSelect={insertEmoji} {customEmojiSets} onSelectCustom={insertCustomEmoji} />
      </div>
    {/if}

    {#if replyingTo}
      <div class="flex items-center gap-2 rounded-t-2xl bg-base-200 px-4 py-2 text-sm shadow-md">
        <ReplyIcon class="h-4 w-4 shrink-0 text-base-content/60" />
        <span class="font-medium text-base-content/60">{getUserDisplayName(replyingTo.pubkey)}</span
        >
        <span class="min-w-0 flex-1 truncate text-base-content/80">{replyingTo.content}</span>
        <button type="button" onclick={() => (replyingTo = null)} class="btn btn-ghost btn-xs">
          ✕
        </button>
      </div>
    {/if}

    <form
      onsubmit={sendMessage}
      class="flex items-center gap-2 {replyingTo
        ? 'rounded-t-none rounded-b-full'
        : 'rounded-full'} bg-base-200 px-2 py-1 shadow-md"
    >
      <button
        type="button"
        onclick={() => (showEmojiPicker = !showEmojiPicker)}
        class="btn btn-circle btn-ghost btn-sm"
        title="Emoji"
      >
        <SmilePlusIcon class="h-5 w-5" />
      </button>

      <input
        bind:this={messageInput}
        type="text"
        bind:value={newMessage}
        placeholder={m.dm_input_placeholder()}
        class="min-w-0 flex-1 border-none bg-transparent focus:outline-none"
        disabled={isSending}
        onfocus={() => (showEmojiPicker = false)}
        required
      />

      <button
        type="submit"
        class="btn btn-circle btn-sm btn-primary"
        disabled={!newMessage.trim() || isSending}
      >
        {#if isSending}
          <span class="loading loading-sm loading-spinner"></span>
        {:else}
          <SendIcon class="h-4 w-4" />
        {/if}
      </button>
    </form>
  </div>
</div>

{#if showEmojiPicker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[9]"
    onclick={() => (showEmojiPicker = false)}
    onkeydown={(e) => {
      if (e.key === 'Escape') showEmojiPicker = false;
    }}
  ></div>
{/if}
