<script>
  import { ChatIcon } from '$lib/components/icons';
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { fetchEvents } from '$lib/loaders/base.js';
  import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityId: string }} */
  let { communityId } = $props();

  // The community's chat messages (kind 9), read from the EventStore like the
  // chat itself. $state.raw: Nostr events.
  /** @type {any[]} */
  let messages = $state.raw([]);
  let isLoading = $state(true);

  // Same relay set as the community chat (app communikey relays + fallback)
  const chatRelays = $derived([
    ...getAppRelaysForCategory('communikey'),
    ...(runtimeConfig.fallbackRelays || [])
  ]);

  // Loader → EventStore → model. Store first: whatever the chat already
  // loaded counts at once; the request completes when the relays answer.
  $effect(() => {
    const id = communityId;
    const relays = chatRelays;
    if (!id) return;
    isLoading = true;
    const filter = { kinds: [9], '#h': [id] };
    const loadSub = fetchEvents(relays, filter).subscribe({
      complete: () => {
        isLoading = false;
      }
    });
    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      messages = events || [];
      if (messages.length > 0) isLoading = false;
    });
    return () => {
      loadSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  let messageCount = $derived(messages.length);
</script>

<div class="stat rounded-lg bg-base-100">
  <div class="stat-figure text-accent">
    <ChatIcon class_="w-8 h-8" />
  </div>
  <div class="stat-title">{m.community_stats_messages_title()}</div>
  {#if isLoading}
    <div class="stat-value text-accent">
      <span class="loading loading-sm loading-spinner"></span>
    </div>
  {:else}
    <div class="stat-value text-accent">{messageCount}</div>
  {/if}
  <div class="stat-desc">{m.community_stats_messages_description()}</div>
</div>
