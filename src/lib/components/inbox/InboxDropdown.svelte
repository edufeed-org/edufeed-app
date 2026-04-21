<script>
  import InboxItem from './InboxItem.svelte';
  import InboxDmItem from './InboxDmItem.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getNotifications,
    markAsRead,
    isNotificationUnread
  } from '$lib/services/inbox-service.svelte.js';
  import { getDmConversations, isDmConversationUnread } from '$lib/services/dm-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const MAX_ITEMS = 6;
  const getActiveUser = useActiveUser();

  /**
   * @typedef {{ type: 'notification', event: import('nostr-tools').NostrEvent, timestamp: number }} NotifItem
   * @typedef {{ type: 'dm', conversation: { id: string, participants: string[], lastMessage: any }, timestamp: number }} DmItem
   */

  let mergedItems = $derived.by(() => {
    /** @type {(NotifItem | DmItem)[]} */
    const items = [];

    for (const event of getNotifications()) {
      items.push({
        type: /** @type {const} */ ('notification'),
        event,
        timestamp: event.created_at
      });
    }

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

    return items.toSorted((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ITEMS);
  });

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
   * @param {{ participants: string[] }} conv
   * @returns {string}
   */
  function getDmOtherPubkey(conv) {
    const user = getActiveUser();
    return conv.participants.find((p) => p !== user?.pubkey) || conv.participants[0] || '';
  }

  function handleMarkAllRead() {
    markAsRead();
  }

  function handleViewAll() {
    goto(resolve('/inbox'));
  }
</script>

<div
  class="max-h-[28rem] w-80 overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-xl"
>
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
    <span class="font-semibold">{m.inbox_title()}</span>
    <button class="text-xs text-primary hover:underline" onclick={handleMarkAllRead}>
      {m.inbox_mark_all_read()}
    </button>
  </div>

  <div class="max-h-80 overflow-y-auto">
    {#if mergedItems.length === 0}
      <div class="py-8 text-center text-sm text-base-content/50">
        {m.inbox_empty()}
      </div>
    {:else}
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
    {/if}
  </div>

  <div class="border-t border-base-300 px-4 py-2 text-center">
    <button class="text-sm text-primary hover:underline" onclick={handleViewAll}>
      {m.inbox_view_all()} →
    </button>
  </div>
</div>
