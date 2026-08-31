<!--
  HomeInboxCard — compact inbox preview for the dashboard Home view.
  Filter chips + up to PREVIEW_COUNT notification/DM items, reusing the
  inbox services and item components from the full inbox page.
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getNotifications,
    getUnreadCount,
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
  import { getPendingInviteCount } from '$lib/concord/pending-invites.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { BellIcon, ChevronRightIcon } from '$lib/components/icons';
  import InboxItem from './InboxItem.svelte';
  import InboxDmItem from './InboxDmItem.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const PREVIEW_COUNT = 4;
  const getActiveUser = useActiveUser();

  let activeFilter = $state('all');

  const filters = [
    { key: 'all', label: () => m.inbox_filter_all() },
    { key: 'messages', label: () => m.inbox_filter_messages() },
    { key: 'reaction', label: () => m.inbox_filter_reactions() },
    { key: 'comment', label: () => m.inbox_filter_comments() },
    { key: 'reply', label: () => m.inbox_filter_replies() },
    { key: 'mention', label: () => m.inbox_filter_mentions() },
    { key: 'rsvp', label: () => m.inbox_filter_rsvps() }
  ];

  let totalUnread = $derived(getUnreadCount() + getUnreadDmCount());

  /**
   * @typedef {{ type: 'notification', event: import('nostr-tools').NostrEvent, timestamp: number }} NotifItem
   * @typedef {{ type: 'dm', conversation: { id: string, participants: string[], lastMessage: any }, timestamp: number }} DmItem
   */
  let mergedItems = $derived.by(() => {
    /** @type {(NotifItem | DmItem)[]} */
    const items = [];

    if (activeFilter !== 'messages') {
      for (const event of filterNotificationsByType(getNotifications(), activeFilter)) {
        items.push({
          type: /** @type {const} */ ('notification'),
          event,
          timestamp: event.created_at
        });
      }
    }

    if (activeFilter === 'all' || activeFilter === 'messages') {
      const conversations =
        activeFilter === 'messages'
          ? getDmConversations()
          : getDmConversations().filter((conv) =>
              isDmConversationUnread(conv.id, conv.lastMessage.created_at)
            );
      for (const conv of conversations) {
        items.push({
          type: /** @type {const} */ ('dm'),
          conversation: conv,
          timestamp: conv.lastMessage.created_at
        });
      }
    }

    return items.toSorted((a, b) => b.timestamp - a.timestamp).slice(0, PREVIEW_COUNT);
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

  let activeFilterLabel = $derived(
    filters.find((f) => f.key === activeFilter)?.label() ?? m.inbox_filter_all()
  );
</script>

<section
  class="overflow-hidden rounded-xl border border-base-300 bg-base-100"
  data-testid="home-inbox-card"
>
  <div class="flex flex-wrap items-center gap-2.5 px-5 pt-4 pb-3">
    <BellIcon class_="h-[18px] w-[18px] text-primary" />
    <h2 class="text-base font-bold">{m.inbox_title()}</h2>
    {#if totalUnread > 0}
      <span
        class="rounded-full border border-base-300 bg-base-200 px-2.5 py-1 font-mono text-[11px] font-semibold text-base-content/70"
      >
        {m.home_inbox_new_pill({ count: totalUnread })}
      </span>
    {/if}
    <div class="ml-auto flex items-center gap-3">
      {#if totalUnread > 0}
        <button
          class="text-xs font-semibold text-primary hover:underline"
          onclick={() => markAsRead()}
        >
          {m.inbox_mark_all_read()}
        </button>
      {/if}
      <button
        class="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        onclick={() => goto(resolve('/c/inbox'))}
      >
        {m.inbox_view_all()}
        <ChevronRightIcon class_="h-3 w-3" />
      </button>
    </div>
  </div>

  <div class="flex flex-wrap gap-2 px-5 pb-3">
    {#each filters as filter (filter.key)}
      {@const isActive = activeFilter === filter.key}
      <button
        class="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors {isActive
          ? 'border-primary bg-primary text-primary-content'
          : 'border-base-300 text-base-content/60 hover:bg-base-200 hover:text-base-content'}"
        onclick={() => (activeFilter = filter.key)}
      >
        {filter.label()}
        {#if filter.key === 'all' && totalUnread > 0}
          <span
            class="min-w-[17px] rounded-full bg-secondary px-1 text-center text-[10px] leading-[17px] font-bold text-secondary-content"
          >
            {totalUnread}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  {#if getPendingInviteCount() > 0}
    <button
      class="flex w-full items-center gap-3 border-t border-base-300 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10"
      data-testid="invite-inbox-cta"
      onclick={() => modalStore.openModal('concordInvites')}
    >
      <span aria-hidden="true">🔒</span>
      <span class="flex-1 text-sm font-medium"
        >{m.concord_invite_inbox_cta({ count: getPendingInviteCount() })}</span
      >
      <span class="text-sm font-semibold text-primary">{m.concord_invite_inbox_action()}</span>
    </button>
  {/if}

  {#if mergedItems.length === 0}
    <div class="border-t border-base-300 p-5 text-center text-sm text-base-content/60">
      {#if activeFilter === 'all'}
        {m.inbox_empty()}
      {:else}
        {m.home_inbox_empty_filtered({ filter: activeFilterLabel })}
      {/if}
    </div>
  {:else}
    <div class="divide-y divide-base-300 border-t border-base-300">
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
