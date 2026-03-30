<script>
  import { resolve } from '$app/paths';
  import { getContext } from 'svelte';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
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

  // Reactive state
  /** @type {any[]} */
  let messages = $state([]);
  /** @type {any} */
  let activeUser = $state(null);
  const getUserProfiles = useProfileMap(() =>
    messages.filter((m) => m && m.pubkey).map((m) => m.pubkey)
  );
  let userProfiles = $derived(getUserProfiles());
  let newMessage = $state('');
  let isLoading = $state(true);
  let isSending = $state(false);

  let displayedMessages = $derived.by(() => {
    const allowed = getAllowedAuthors?.();
    const valid = messages.filter((m) => m && m.id && m.pubkey && m.content);
    return allowed ? valid.filter((m) => allowed.includes(m.pubkey)) : valid;
  });

  // Derive community pubkey from communikey event if not provided as prop
  let derivedCommunityPubkey = $derived(communityPubkey || communikeyEvent?.pubkey || '');

  // Subscribe to active user
  $effect(() => {
    const subscription = manager.active$.subscribe((user) => {
      activeUser = user;
    });
    return () => subscription.unsubscribe();
  });

  // Subscribe to chat messages
  $effect(() => {
    if (!derivedCommunityPubkey) return;

    isLoading = true;
    let initialLoadComplete = false;

    // Use communikey relays + fallback for chat messages
    const chatRelays = [
      ...getAppRelaysForCategory('communikey'),
      ...(runtimeConfig.fallbackRelays || [])
    ];
    // Create a persistent subscription that continues after EOSE
    const subscription = pool
      .group(chatRelays)
      .subscription({ kinds: [9], '#h': [derivedCommunityPubkey] })
      .subscribe({
        next: (response) => {
          if (response === 'EOSE') {
            console.log('End of stored events - switching to real-time mode');
            initialLoadComplete = true;
            isLoading = false;
          } else if (response && typeof response === 'object' && response.kind === 9) {
            // This is an actual event
            console.log('Received chat event:', response);

            // Add to eventStore for persistence
            eventStore.add(response);

            // Add message to list if not already present
            const existingIndex = messages.findIndex((m) => m.id === response.id);
            if (existingIndex === -1) {
              messages = [...messages, response].sort((a, b) => a.created_at - b.created_at);
            }

            // If this is the first event after EOSE, mark loading as complete
            if (initialLoadComplete && isLoading) {
              isLoading = false;
            }
          }
        },
        error: (error) => {
          console.error('Chat subscription error:', error);
          isLoading = false;
        }
      });

    return () => subscription.unsubscribe();
  });

  // Send message function
  /**
   * @param {Event} event
   */
  async function sendMessage(event) {
    event.preventDefault();

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

      // Add immediately to local messages for instant UI feedback
      messages = [...messages, signedEvent].sort((a, b) => a.created_at - b.created_at);
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

  // Auto-scroll to bottom when new messages arrive
  /** @type {HTMLElement} */
  let chatContainer;
  $effect(() => {
    if (chatContainer && displayedMessages.length > 0) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
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
    {#if displayedMessages.length === 0 && !isLoading}
      <div class="py-8 text-center text-base-content/50">
        {m.community_views_chat_empty()}
      </div>
    {/if}

    {#each displayedMessages as message (message.id)}
      {@const isOwnMessage = activeUser && message.pubkey === activeUser.pubkey}
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
  {#if activeUser && canPublish}
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
