<script>
  import { resolve } from '$app/paths';
  import { getContext } from 'svelte';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useUserEmojiSets } from '$lib/stores/user-emoji-sets.svelte.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import {
    formatMessageTimestamp,
    getUserDisplayName as getDisplayName,
    getReplyParentId,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import { TimelineModel } from 'applesauce-core/models';
  import NostrContentRenderer from '$lib/components/shared/NostrContentRenderer.svelte';
  import LinkPreviewList from '$lib/components/shared/LinkPreviewList.svelte';
  import EmojiPicker from '$lib/components/shared/EmojiPicker.svelte';
  import { SmilePlusIcon, SendIcon, ReplyIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';
  import ProfileAvatar from '../../shared/ProfileAvatar.svelte';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
  import { extractMentionPubkeys } from '$lib/helpers/inbox.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';

  const getAllowedAuthors = getContext('allowedAuthors');

  /** @type {any} */
  let {
    communikeyEvent,
    _communityProfile = null,
    communityPubkey = '',
    canPublish = true
  } = $props();

  const PAGE_SIZE = 20;

  // Reactive state
  let messages = $state.raw(/** @type {any[]} */ ([]));
  const getActiveUser = useActiveUser();
  const getUserProfiles = useProfileMap(() =>
    messages.filter((m) => m && m.pubkey).map((m) => m.pubkey)
  );
  let userProfiles = $derived(getUserProfiles());
  let newMessage = $state('');
  let isLoading = $state(true);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let isSending = $state(false);
  let showEmojiPicker = $state(false);

  // Custom emoji state
  const getUserEmojiSets = useUserEmojiSets();
  let customEmojiSets = $derived(getUserEmojiSets());
  /** @type {Record<string, { shortcode: string, url: string }>} */
  let usedCustomEmojis = {};

  // Reply state
  /** @type {any} */
  let replyingTo = $state(null);

  /** @type {HTMLInputElement | undefined} */
  let messageInput = $state(undefined);

  let displayedMessages = $derived.by(() => {
    const allowed = getAllowedAuthors?.();
    const valid = messages.filter((m) => m && m.id && m.pubkey && m.content);
    const filtered = allowed ? valid.filter((m) => allowed.includes(m.pubkey)) : valid;
    // TimelineModel returns newest-first; chat needs oldest-first
    return filtered.toReversed();
  });

  // Group messages by date for separators
  let groupedMessages = $derived(groupMessagesByDate(displayedMessages));

  // Derive community pubkey from communikey event if not provided as prop
  let derivedCommunityPubkey = $derived(communityPubkey || communikeyEvent?.pubkey || '');

  // Track chat relays and base filter for reuse in loadMore
  let chatRelays = $derived([
    ...getAppRelaysForCategory('communikey'),
    ...(runtimeConfig.fallbackRelays || [])
  ]);

  // Subscribe to chat messages using storeEvents + TimelineModel pattern.
  // isLoading clears on whichever happens first: model emits events, EOSE
  // arrives, error, or a fallback timeout. The fallback is required because
  // pool.group(...).subscription(...) does not reliably deliver EOSE on a
  // tab-switch resubscribe (cold reload works because connection state is
  // fresh). The pool's eoseTimeout is 3s; we add a small grace period.
  $effect(() => {
    if (!derivedCommunityPubkey) return;

    isLoading = true;
    hasMore = true;
    const filter = { kinds: [9], '#h': [derivedCommunityPubkey] };

    const fallbackTimer = setTimeout(() => {
      isLoading = false;
    }, 4000);

    const subSub = pool
      .group(chatRelays)
      .subscription({ ...filter, limit: PAGE_SIZE })
      .pipe(storeEvents(eventStore))
      .subscribe({
        next: (response) => {
          if (response === 'EOSE') isLoading = false;
        },
        error: () => {
          isLoading = false;
        }
      });

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      messages = events;
      // First batch of events means we have something to render — drop the
      // spinner immediately so users see content even if EOSE never arrives.
      if (events.length > 0) isLoading = false;
    });

    return () => {
      clearTimeout(fallbackTimer);
      subSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** Load older messages before the oldest currently displayed */
  function loadMore() {
    if (isLoadingMore || !derivedCommunityPubkey || messages.length === 0) return;

    isLoadingMore = true;
    const oldestTimestamp = messages[messages.length - 1].created_at;

    const olderFilter = {
      kinds: [9],
      '#h': [derivedCommunityPubkey],
      until: oldestTimestamp - 1,
      limit: PAGE_SIZE
    };

    let count = 0;
    const sub = pool
      .group(chatRelays)
      .subscription(olderFilter)
      .pipe(storeEvents(eventStore))
      .subscribe({
        next: (response) => {
          if (response === 'EOSE') {
            if (count < PAGE_SIZE) hasMore = false;
            isLoadingMore = false;
            sub.unsubscribe();
          } else {
            count++;
          }
        },
        error: () => {
          isLoadingMore = false;
          sub.unsubscribe();
        }
      });
  }

  /**
   * @param {Event} event
   */
  async function sendMessage(event) {
    event.preventDefault();

    const activeUser = getActiveUser();
    if (!activeUser || !newMessage.trim() || !derivedCommunityPubkey) return;

    const messageContent = newMessage.trim();
    newMessage = '';
    isSending = true;

    try {
      const mentionTags = extractMentionPubkeys(messageContent).map((pk) => ['p', pk]);
      const chatEvent = {
        kind: 9,
        content: messageContent,
        tags: [['h', derivedCommunityPubkey], ...mentionTags],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: activeUser.pubkey
      };

      // Add reply tags (NIP-10 markers)
      if (replyingTo) {
        chatEvent.tags.push(['e', replyingTo.id, '', 'reply']);
        chatEvent.tags.push(['p', replyingTo.pubkey]);
      }

      // Add custom emoji tags for any shortcodes used in content
      for (const shortcode of Object.keys(usedCustomEmojis)) {
        if (messageContent.includes(`:${shortcode}:`)) {
          chatEvent.tags.push(['emoji', shortcode, usedCustomEmojis[shortcode].url]);
        }
      }

      const signedEvent = await activeUser.signer.signEvent(chatEvent);
      isSending = false;

      eventStore.add(signedEvent);

      publishEventOptimistic(signedEvent, [derivedCommunityPubkey], {
        communityEvent: communikeyEvent
      });

      // Clear reply and custom emoji state after sending
      replyingTo = null;
      usedCustomEmojis = {};
    } catch (error) {
      console.error('Failed to send message:', error);
      newMessage = messageContent;
      isSending = false;
    }
  }

  /** @param {string} pubkey */
  function getUserDisplayName(pubkey) {
    return getDisplayName(pubkey, userProfiles.get(pubkey));
  }

  /** Insert unicode emoji at cursor position in message input */
  function insertEmoji(/** @type {string} */ emoji) {
    newMessage += emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  /** Insert custom emoji shortcode and track for tagging */
  function insertCustomEmoji(/** @type {{ shortcode: string, url: string }} */ emoji) {
    newMessage += `:${emoji.shortcode}:`;
    usedCustomEmojis[emoji.shortcode] = emoji;
    showEmojiPicker = false;
    messageInput?.focus();
  }

  // Auto-scroll to bottom when new messages arrive (only if already near bottom)
  /** @type {HTMLElement} */
  let chatContainer;
  let prevMessageCount = 0;
  $effect(() => {
    if (chatContainer && displayedMessages.length > 0) {
      const isNewMessage = displayedMessages.length > prevMessageCount;
      const isNearBottom =
        chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
      if (prevMessageCount === 0 || (isNewMessage && isNearBottom)) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      prevMessageCount = displayedMessages.length;
    }
  });

  // Auto-load older messages on scroll to top
  function handleScroll() {
    if (chatContainer && chatContainer.scrollTop < 50 && hasMore && !isLoadingMore) {
      loadMore();
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- Messages container -->
  <div
    bind:this={chatContainer}
    onscroll={handleScroll}
    class="flex-1 space-y-1 overflow-y-auto px-4 py-2"
  >
    {#if isLoadingMore}
      <div class="flex justify-center py-2">
        <span class="loading loading-sm loading-spinner"></span>
      </div>
    {/if}

    {#if isLoading}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-md loading-spinner"></span>
      </div>
    {:else if displayedMessages.length === 0}
      <div class="py-8 text-center text-base-content/50">
        {m.community_views_chat_empty()}
      </div>
    {:else}
      {#each groupedMessages as item, i (item.type === 'separator' ? `sep-${item.date}-${i}` : item.message.id)}
        {#if item.type === 'separator'}
          <div class="divider text-xs text-base-content/40">{item.date}</div>
        {:else}
          {@const message = item.message}
          {@const isOwnMessage = getActiveUser() && message.pubkey === getActiveUser()?.pubkey}
          {@const replyToId = getReplyParentId(message)}
          <div class="group chat {isOwnMessage ? 'chat-end' : 'chat-start'}">
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
                <a href={resolve(profileLink(message.pubkey))} class="font-semibold hover:underline"
                  >{getUserDisplayName(message.pubkey)}</a
                >
                <span>&middot;</span>
              {/if}
              <time datetime={new Date(message.created_at * 1000).toISOString()}>
                {formatMessageTimestamp(message.created_at)}
              </time>
              {#if getActiveUser() && canPublish}
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
              {/if}
            </div>

            <div class="chat-bubble {isOwnMessage ? 'chat-bubble-primary' : ''}">
              <!-- Reply quote preview -->
              {#if replyToId}
                {@const parent = displayedMessages.find((msg) => msg.id === replyToId)}
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
              <LinkPreviewList event={message} />
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- Floating pill input -->
  {#if getActiveUser() && canPublish}
    <div class="relative px-4 pt-2 pb-4">
      <!-- Emoji picker dropdown -->
      {#if showEmojiPicker}
        <div
          class="absolute bottom-full left-4 z-10 mb-2 flex max-h-80 w-72 flex-col rounded-lg bg-base-200 shadow-xl"
        >
          <EmojiPicker
            onSelect={insertEmoji}
            {customEmojiSets}
            onSelectCustom={insertCustomEmoji}
          />
        </div>
      {/if}

      <!-- Reply preview bar -->
      {#if replyingTo}
        <div class="flex items-center gap-2 rounded-t-2xl bg-base-200 px-4 py-2 text-sm shadow-md">
          <ReplyIcon class="h-4 w-4 shrink-0 text-base-content/60" />
          <span class="font-medium text-base-content/60"
            >{getUserDisplayName(replyingTo.pubkey)}</span
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
          placeholder={m.community_views_chat_input_placeholder()}
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
  {:else}
    <div class="px-4 pt-2 pb-4">
      <div class="text-center text-base-content/70">
        <p>{m.community_views_chat_login_prompt()}</p>
      </div>
    </div>
  {/if}
</div>

<!-- Close emoji picker when clicking outside -->
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
