<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { manager } from '$lib/stores/accounts.svelte';
  import {
    getNotifications,
    getUnreadCount,
    getUnreadByType,
    getReadMarkers,
    markAsRead
  } from '$lib/services/inbox-service.svelte.js';
  import { getNotificationType, isUnread } from '$lib/helpers/inbox.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import InboxItem from '$lib/components/inbox/InboxItem.svelte';
  import * as m from '$lib/paraglide/messages.js';

  // Auth guard
  $effect(() => {
    if (!manager.active) goto(resolve('/'));
  });

  let activeFilter = $state('all');

  const filters = [
    { key: 'all', label: () => m.inbox_filter_all() },
    { key: 'formRequest', label: () => m.inbox_filter_forms() },
    { key: 'reaction', label: () => m.inbox_filter_reactions() },
    { key: 'comment', label: () => m.inbox_filter_comments() },
    { key: 'mention', label: () => m.inbox_filter_mentions() },
    { key: 'rsvp', label: () => m.inbox_filter_rsvps() }
  ];

  let allNotifications = $derived(getNotifications());
  let markers = $derived(getReadMarkers());
  let countsByType = $derived(getUnreadByType());

  let filteredNotifications = $derived.by(() => {
    if (activeFilter === 'all') return allNotifications;
    if (activeFilter === 'formRequest') {
      return allNotifications.filter((e) => {
        const t = getNotificationType(e);
        return t === 'formRequest' || t === 'formResponse';
      });
    }
    return allNotifications.filter((e) => getNotificationType(e) === activeFilter);
  });

  const getProfiles = useProfileMap(() => filteredNotifications.map((n) => n.pubkey));
  let profiles = $derived(getProfiles());
</script>

<div class="mx-auto max-w-3xl px-4 py-6">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-bold">{m.inbox_title()}</h1>
    {#if getUnreadCount() > 0}
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
          ? getUnreadCount()
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
  {#if filteredNotifications.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <p class="text-base-content/60">{m.inbox_empty()}</p>
    </div>
  {:else}
    <div class="divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300">
      {#each filteredNotifications as event (event.id)}
        <InboxItem {event} profile={profiles.get(event.pubkey)} unread={isUnread(event, markers)} />
      {/each}
    </div>
  {/if}
</div>
