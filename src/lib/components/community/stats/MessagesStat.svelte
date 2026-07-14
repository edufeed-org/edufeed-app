<script>
  import { ChatIcon } from '$lib/components/icons';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  // Props
  let { communityId } = $props();

  // Local state - completely isolated
  /** @type {any[]} */
  let messages = $state([]);
  let isLoading = $state(true);
  let error = $state(null);

  /**
   * Get communikey relays from app config
   * @returns {string[]}
   */
  function getCommunikeyRelays() {
    return [
      ...(runtimeConfig.appRelays?.communikey || []),
      ...(runtimeConfig.fallbackRelays || [])
    ];
  }

  // Load messages
  $effect(() => {
    if (!communityId) {
      console.log('💬 MessagesStat: No communityId provided, skipping load');
      return;
    }

    // Reset state
    messages = [];
    isLoading = true;
    error = null;

    // v6: subscription() emits only events (no 'EOSE' marker) — resolve the
    // spinner on the first event or via the fallback timer.
    const spinnerTimer = setTimeout(() => {
      isLoading = false;
    }, 4000);

    const sub = pool
      .group(getCommunikeyRelays())
      .subscription({ kinds: [9], '#h': [communityId] })
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (event && typeof event === 'object' && event.kind === 9) {
            isLoading = false;
            messages = [...messages, event];
          }
        },
        error: (/** @type {any} */ err) => {
          console.error('💬 MessagesStat: Error loading messages:', err);
          error = err.message || 'Failed to load messages';
          isLoading = false;
        }
      });

    return () => {
      clearTimeout(spinnerTimer);
      sub.unsubscribe();
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
  {:else if error}
    <div class="stat-value text-sm text-error">{m.community_stats_messages_error()}</div>
    <div class="stat-desc text-xs text-error">{error}</div>
  {:else}
    <div class="stat-value text-accent">{messageCount}</div>
  {/if}
  <div class="stat-desc">{m.community_stats_messages_description()}</div>
</div>
