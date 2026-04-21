<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getNotifications,
    getTotalUnreadCount,
    isNotificationUnread
  } from '$lib/services/inbox-service.svelte.js';
  import { getDmConversations, isDmConversationUnread } from '$lib/services/dm-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { BellIcon } from '$lib/components/icons';
  import InboxItem from './InboxItem.svelte';
  import InboxDmItem from './InboxDmItem.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const PREVIEW_COUNT = 3;
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

    return items.toSorted((a, b) => b.timestamp - a.timestamp).slice(0, PREVIEW_COUNT);
  });

  let count = $derived(getTotalUnreadCount());

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
</script>

<section>
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-lg font-semibold">{m.inbox_title()}</h2>
    <button class="btn text-primary btn-ghost btn-sm" onclick={() => goto(resolve('/inbox'))}>
      {m.inbox_view_all()} →
    </button>
  </div>

  {#if count > 0}
    <div class="mb-3 text-sm text-base-content/70">
      {m.inbox_unread_summary({ count })}
    </div>
  {/if}

  {#if mergedItems.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-8 text-center"
    >
      <BellIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.inbox_empty()}</p>
    </div>
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
</section>
