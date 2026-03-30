<script>
  import { resolve } from '$app/paths';
  import { getContext } from 'svelte';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { storeEvents } from 'applesauce-relay/operators';
  import { TimelineModel } from 'applesauce-core/models';
  import NostrIdentifierParser from '$lib/components/shared/NostrIdentifierParser.svelte';
  import CompactCommunityHeader from '$lib/components/community/layout/CompactCommunityHeader.svelte';
  import * as m from '$lib/paraglide/messages';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
  import { extractMentionPubkeys } from '$lib/helpers/inbox.js';

  const getAllowedAuthors = getContext('allowedAuthors');

  /** @type {any} */
  let {
    communikeyEvent,
    communityProfile = null,
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

  let displayedMessages = $derived.by(() => {
    const allowed = getAllowedAuthors?.();
    const valid = messages.filter((m) => m && m.id && m.pubkey && m.content);
    const filtered = allowed ? valid.filter((m) => allowed.includes(m.pubkey)) : valid;
    // TimelineModel returns newest-first; chat needs oldest-first
    return filtered.toReversed();
  });

  // Derive community pubkey from communikey event if not provided as prop
  let derivedCommunityPubkey = $derived(communityPubkey || communikeyEvent?.pubkey || '');

  // Track chat relays and base filter for reuse in loadMore
  let chatRelays = $derived([
    ...getAppRelaysForCategory('communikey'),
    ...(runtimeConfig.fallbackRelays || [])
  ]);

  // Subscribe to chat messages using storeEvents + TimelineModel pattern
  $effect(() => {
    if (!derivedCommunityPubkey) return;

    isLoading = true;
    hasMore = true;
    const filter = { kinds: [9], '#h': [derivedCommunityPubkey] };

    // 1. Persistent subscription with limit for initial load
    //    limit only affects stored events before EOSE; real-time events still arrive
    const subSub = pool
      .group(chatRelays)
      .subscription({ ...filter, limit: PAGE_SIZE })
      .pipe(storeEvents(eventStore))
      .subscribe({
        next: (response) => {
          if (response === 'EOSE') isLoading = false;
        },
        error: (err) => {
          console.error('Chat subscription error:', err);
          isLoading = false;
        }
      });

    // 2. TimelineModel provides sorted, deduped, deletion-filtered view
    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      messages = events;
    });

    return () => {
      subSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /** Load older messages before the oldest currently displayed */
  function loadMore() {
    if (isLoadingMore || !derivedCommunityPubkey || messages.length === 0) return;

    isLoadingMore = true;
    // messages is newest-first from TimelineModel, so last element is oldest
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

  // Send message function
  /**
   * @param {Event} event
   */
  async function sendMessage(event) {
    event.preventDefault();

    const activeUser = getActiveUser();
    if (!activeUser || !newMessage.trim() || !derivedCommunityPubkey) return;

    const messageContent = newMessage.trim();
    newMessage = ''; // Clear input immediately for instant feedback
    isSending = true; // Show loading during signing

    try {
      // Create kind 9 event with community h-tag + mention p-tags
      const mentionTags = extractMentionPubkeys(messageContent).map((pk) => ['p', pk]);
      const chatEvent = {
        kind: 9,
        content: messageContent,
        tags: [['h', derivedCommunityPubkey], ...mentionTags],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: activeUser.pubkey
      };

      // Sign the event (may require user approval in browser extension)
      const signedEvent = await activeUser.signer.signEvent(chatEvent);
      isSending = false; // Signing complete

      // Add to EventStore — TimelineModel subscription picks it up automatically
      eventStore.add(signedEvent);

      // Publish optimistically in background (returns immediately)
      publishEventOptimistic(signedEvent, [derivedCommunityPubkey], {
        communityEvent: communikeyEvent
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message if signing failed
      newMessage = messageContent;
      isSending = false;
    }
  }

  // Format timestamp
  /**
   * @param {number} timestamp
   */
  function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'now'; // Less than 1 minute
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`; // Minutes
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`; // Hours
    return formatCalendarDate(date, 'short'); // Date with configured locale
  }

  // Get user display name
  /**
   * @param {string} pubkey
   */
  function getUserDisplayName(pubkey) {
    if (!pubkey) return 'Unknown User';
    const profile = userProfiles.get(pubkey);
    if (profile) {
      return profile.display_name || profile.name || pubkey.slice(0, 8) + '...';
    }
    return pubkey.slice(0, 8) + '...';
  }

  // Get user avatar
  /**
   * @param {string} pubkey
   */
  function getUserAvatar(pubkey) {
    if (!pubkey) return null;
    const profile = userProfiles.get(pubkey);
    if (profile) {
      return getProfilePicture(profile);
    }
    return null;
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
      // Auto-scroll on initial load or when near bottom and new messages arrive
      if (prevMessageCount === 0 || (isNewMessage && isNearBottom)) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      prevMessageCount = displayedMessages.length;
    }
  });
</script>

<div class="flex flex-col rounded-lg border bg-base-100" style="height: calc(100vh - 20rem);">
  <!-- Community Context Header -->
  {#if communityProfile && communityPubkey}
    <CompactCommunityHeader {communityProfile} {communityPubkey} />
  {/if}

  <!-- Chat header -->
  <div class="border-b bg-base-200 px-4 py-2">
    <h3 class="font-semibold text-base-content">{m.community_views_chat_title()}</h3>
    {#if isLoading}
      <div class="text-sm text-base-content/70">{m.community_views_chat_loading()}</div>
    {:else}
      <div class="text-sm text-base-content/70">
        {displayedMessages.length}
        {m.community_views_chat_message_count()}
      </div>
    {/if}
  </div>

  <!-- Messages container -->
  <div bind:this={chatContainer} class="flex-1 space-y-4 overflow-y-auto p-4">
    {#if hasMore && displayedMessages.length > 0}
      <div class="text-center">
        <button class="btn btn-ghost btn-sm" onclick={loadMore} disabled={isLoadingMore}>
          {#if isLoadingMore}
            <span class="loading loading-sm loading-spinner"></span>
          {:else}
            {m.community_views_chat_load_more()}
          {/if}
        </button>
      </div>
    {/if}

    {#if displayedMessages.length === 0 && !isLoading}
      <div class="py-8 text-center text-base-content/50">
        {m.community_views_chat_empty()}
      </div>
    {/if}

    {#each displayedMessages as message (message.id)}
      {@const isOwnMessage = getActiveUser() && message.pubkey === getActiveUser()?.pubkey}
      <div class="chat {isOwnMessage ? 'chat-end' : 'chat-start'}">
        {#if !isOwnMessage}
          <a href={resolve(`/p/${message.pubkey}`)} class="avatar chat-image">
            <div class="w-8 rounded-full">
              {#if getUserAvatar(message.pubkey)}
                <img
                  src={getUserAvatar(message.pubkey)}
                  alt={getUserDisplayName(message.pubkey)}
                  onerror={(e) => {
                    const img = /** @type {HTMLImageElement} */ (/** @type {unknown} */ (e.target));
                    if (img) img.src = `https://robohash.org/${message.pubkey}`;
                  }}
                />
              {:else}
                <div
                  class="flex h-full w-full items-center justify-center bg-primary text-xs text-primary-content"
                >
                  {getUserDisplayName(message.pubkey).charAt(0).toUpperCase()}
                </div>
              {/if}
            </div>
          </a>
        {/if}

        <div class="chat-header mb-1 text-xs opacity-70">
          {#if !isOwnMessage}
            <a href={resolve(`/p/${message.pubkey}`)} class="font-semibold hover:underline"
              >{getUserDisplayName(message.pubkey)}</a
            >
            <span class="mx-1">•</span>
          {/if}
          <time datetime={new Date(message.created_at * 1000).toISOString()}>
            {formatTimestamp(message.created_at)}
          </time>
        </div>

        <div class="chat-bubble {isOwnMessage ? 'chat-bubble-primary' : ''}">
          <NostrIdentifierParser text={message.content} />
        </div>
      </div>
    {/each}
  </div>

  <!-- Message input -->
  {#if getActiveUser() && canPublish}
    <form onsubmit={sendMessage} class="rounded-b-lg border-t bg-base-100 p-4">
      <div class="flex gap-2">
        <input
          type="text"
          bind:value={newMessage}
          placeholder={m.community_views_chat_input_placeholder()}
          class="input-bordered input flex-1"
          disabled={isSending}
          required
        />
        <button type="submit" class="btn btn-primary" disabled={!newMessage.trim() || isSending}>
          {#if isSending}
            <span class="loading loading-sm loading-spinner"></span>
          {:else}
            {m.community_views_chat_send_button()}
          {/if}
        </button>
      </div>
    </form>
  {:else}
    <div class="rounded-b-lg border-t bg-base-100 p-4">
      <div class="text-center text-base-content/70">
        <p class="mb-2">{m.community_views_chat_login_prompt()}</p>
        <!-- TODO: Add login button/component -->
      </div>
    </div>
  {/if}
</div>
