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
  import { getKnownDmConversations, isDmConversationUnread } from '$lib/services/dm-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import {
    getPendingInviteCount,
    getFirstPendingInvite
  } from '$lib/concord/pending-invites.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { modalStore } from '$lib/stores/modal.svelte.js';

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

    const unreadDms = getKnownDmConversations().filter((conv) =>
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
    // Inviter of the first decrypted pending invite — resolved for the
    // pinned invites row above the list.
    const inviter = getFirstPendingInvite()?.inviter;
    if (inviter) pubkeys.push(inviter);
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

  /** @param {string | undefined} pubkey */
  function inviterName(pubkey) {
    if (!pubkey) return '?';
    return getDisplayName(getProfiles().get(pubkey)) || pubkey.slice(0, 12);
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

  {#if getPendingInviteCount() > 0}
    <!-- Pinned above the notification list: E2E invites arrive as encrypted
      gift wraps (never DMs), so before the deliberate decrypt step the ONLY
      honest information is the count — and this bell is the one global
      surface a recipient who does not expect an invite will actually check
      (UX consult 2026-08-17). -->
    <button
      class="flex w-full items-start gap-3 border-b border-base-300 bg-primary/5 px-4 py-3 text-left hover:bg-primary/10"
      data-testid="inbox-invites-row"
      onclick={() => modalStore.openModal('concordInvites')}
    >
      <span aria-hidden="true">🔒</span>
      <span class="min-w-0 flex-1">
        {#if getFirstPendingInvite()}
          {@const invite = getFirstPendingInvite()}
          <span class="block text-sm font-medium">
            {m.inbox_invites_row_known({
              inviter: inviterName(invite?.inviter),
              area: invite?.areaName ?? m.concord_invite_generic()
            })}
          </span>
          {#if getPendingInviteCount() > 1}
            <span class="block text-xs text-base-content/60"
              >{m.inbox_invites_row_more({ count: getPendingInviteCount() - 1 })}</span
            >
          {/if}
        {:else}
          <span class="block text-sm font-medium"
            >{m.inbox_invites_row_title({ count: getPendingInviteCount() })}</span
          >
          <span class="block text-xs text-base-content/60">{m.inbox_invites_row_body()}</span>
        {/if}
      </span>
      <span class="text-sm font-semibold text-primary">{m.inbox_invites_row_action()}</span>
    </button>
  {/if}

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
