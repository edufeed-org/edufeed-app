<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    getNotifications,
    getUnreadCount,
    isNotificationUnread
  } from '$lib/services/inbox-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { BellIcon } from '$lib/components/icons';
  import InboxItem from './InboxItem.svelte';
  import * as m from '$lib/paraglide/messages.js';

  const PREVIEW_COUNT = 3;

  let items = $derived(getNotifications().slice(0, PREVIEW_COUNT));
  let count = $derived(getUnreadCount());

  const getProfiles = useProfileMap(() => items.map((n) => n.pubkey));
  let profiles = $derived(getProfiles());
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

  {#if items.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-8 text-center"
    >
      <BellIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.inbox_empty()}</p>
    </div>
  {:else}
    <div class="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300">
      {#each items as event (event.id)}
        <InboxItem
          {event}
          profile={profiles.get(event.pubkey)}
          unread={isNotificationUnread(event)}
        />
      {/each}
    </div>
  {/if}
</section>
