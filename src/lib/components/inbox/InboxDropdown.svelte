<script>
  import InboxItem from './InboxItem.svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getNotifications,
    markAsRead,
    isNotificationUnread
  } from '$lib/services/inbox-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  const MAX_ITEMS = 6;

  const getProfiles = useProfileMap(() => {
    const notifs = getNotifications();
    return notifs.slice(0, MAX_ITEMS).map((n) => n.pubkey);
  });

  let profiles = $derived(getProfiles());
  let items = $derived(getNotifications().slice(0, MAX_ITEMS));

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
    {#if items.length === 0}
      <div class="py-8 text-center text-sm text-base-content/50">
        {m.inbox_empty()}
      </div>
    {:else}
      {#each items as event (event.id)}
        <InboxItem
          {event}
          profile={profiles.get(event.pubkey)}
          unread={isNotificationUnread(event)}
        />
      {/each}
    {/if}
  </div>

  <div class="border-t border-base-300 px-4 py-2 text-center">
    <button class="text-sm text-primary hover:underline" onclick={handleViewAll}>
      {m.inbox_view_all()} →
    </button>
  </div>
</div>
