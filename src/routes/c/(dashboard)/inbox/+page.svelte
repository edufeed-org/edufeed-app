<script>
  import {
    getNotifications,
    getUnreadCount,
    getUnreadByType,
    markAsRead,
    isNotificationUnread
  } from '$lib/services/inbox-service.svelte.js';
  import {
    getDmConversations,
    getUnreadDmCount,
    isDmConversationUnread
  } from '$lib/services/dm-service.svelte.js';
  import { filterNotificationsByType } from '$lib/helpers/inbox.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import InboxItem from '$lib/components/inbox/InboxItem.svelte';
  import InboxDmItem from '$lib/components/inbox/InboxDmItem.svelte';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const getActiveUser = useActiveUser();

  let activeFilter = $state('all');

  const filters = [
    { key: 'all', label: () => m.inbox_filter_all() },
    { key: 'messages', label: () => m.inbox_filter_messages() },
    { key: 'formRequest', label: () => m.inbox_filter_forms() },
    { key: 'reaction', label: () => m.inbox_filter_reactions() },
    { key: 'wave', label: () => m.inbox_filter_waves() },
    { key: 'comment', label: () => m.inbox_filter_comments() },
    { key: 'mention', label: () => m.inbox_filter_mentions() },
    { key: 'rsvp', label: () => m.inbox_filter_rsvps() }
  ];

  let allNotifications = $derived(getNotifications());
  let countsByType = $derived(getUnreadByType());

  /**
   * Build merged items list based on active filter.
   * @typedef {{ type: 'notification', event: import('nostr-tools').NostrEvent, timestamp: number }} NotificationItem
   * @typedef {{ type: 'dm', conversation: { id: string, participants: string[], lastMessage: any }, timestamp: number }} DmItem
   * @typedef {NotificationItem | DmItem} InboxItem_
   */
  let mergedItems = $derived.by(() => {
    if (activeFilter === 'messages') {
      // Show all DM conversations (both read and unread), sorted by recency
      return getDmConversations().map((conv) => ({
        type: /** @type {const} */ ('dm'),
        conversation: conv,
        timestamp: conv.lastMessage.created_at
      }));
    }

    // For notification-only filters
    const filteredNotifs = filterNotificationsByType(allNotifications, activeFilter);

    /** @type {InboxItem_[]} */
    const items = filteredNotifs.map((event) => ({
      type: /** @type {const} */ ('notification'),
      event,
      timestamp: event.created_at
    }));

    // For "all" filter, merge in unread DM conversations
    if (activeFilter === 'all') {
      const unreadDms = getDmConversations().filter((conv) =>
        isDmConversationUnread(conv.id, conv.lastMessage.created_at)
      );
      for (const conv of unreadDms) {
        items.push({
          type: /** @type {const} */ ('dm'),
          conversation: conv,
          timestamp: conv.lastMessage.created_at
        });
      }
    }

    return items.toSorted((a, b) => b.timestamp - a.timestamp);
  });

  // Profile loading for both notification authors and DM participants
  const getProfiles = useProfileMap(() => {
    const user = getActiveUser();
    /** @type {string[]} */
    const pubkeys = [];
    for (const item of mergedItems) {
      if (item.type === 'notification') {
        if (!pubkeys.includes(item.event.pubkey)) pubkeys.push(item.event.pubkey);
      } else {
        for (const p of item.conversation.participants) {
          if (p !== user?.pubkey && !pubkeys.includes(p)) pubkeys.push(p);
        }
      }
    }
    return pubkeys;
  });
  let profiles = $derived(getProfiles());

  /**
   * Get the "other" participant pubkey for a DM conversation.
   * @param {{ participants: string[] }} conv
   * @returns {string}
   */
  function getDmOtherPubkey(conv) {
    const user = getActiveUser();
    return conv.participants.find((p) => p !== user?.pubkey) || conv.participants[0] || '';
  }
</script>

<svelte:head><title>{m.inbox_title()}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-bold">{m.inbox_title()}</h1>
    {#if getUnreadCount() + getUnreadDmCount() > 0}
      <button class="btn text-primary btn-ghost btn-sm" onclick={() => markAsRead()}>
        {m.inbox_mark_all_read()}
      </button>
    {/if}
  </div>

  <!-- Filter pills -->
  <div class="mb-6 flex flex-wrap gap-2">
    {#each filters as filter (filter.key)}
      {@const count =
        filter.key === 'all'
          ? getUnreadCount() + getUnreadDmCount()
          : filter.key === 'messages'
            ? getUnreadDmCount()
            : filter.key === 'formRequest'
              ? (countsByType['formRequest'] || 0) + (countsByType['formResponse'] || 0)
              : countsByType[filter.key] || 0}
      <button
        class="btn btn-sm {activeFilter === filter.key ? 'btn-primary' : 'btn-ghost'}"
        onclick={() => (activeFilter = filter.key)}
      >
        {filter.label()}
        {#if count > 0}
          <span class="ml-1 badge badge-sm badge-primary">{count}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Notification list -->
  {#if mergedItems.length === 0}
    <EmptyState title={m.inbox_empty()} />
  {:else}
    <div class="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300">
      {#each mergedItems as item (item.type === 'dm' ? `dm-${item.conversation.id}` : item.event.id)}
        {#if item.type === 'dm'}
          <InboxDmItem
            conversation={item.conversation}
            profile={profiles.get(getDmOtherPubkey(item.conversation))}
            unread={isDmConversationUnread(
              item.conversation.id,
              item.conversation.lastMessage.created_at
            )}
          />
        {:else}
          <InboxItem
            event={item.event}
            profile={profiles.get(item.event.pubkey)}
            unread={isNotificationUnread(item.event)}
          />
        {/if}
      {/each}
    </div>
  {/if}
</div>
