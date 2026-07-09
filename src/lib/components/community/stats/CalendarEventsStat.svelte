<script>
  import { onMount } from 'svelte';
  import { CalendarIcon } from '$lib/components/icons';
  import { useCalendarEventLoader } from '$lib/loaders/calendar-event-loader.svelte.js';
  import { filterValidEvents } from '$lib/helpers/eventValidation.js';
  import * as m from '$lib/paraglide/messages';

  // Props
  let { communityId } = $props();

  // Local state
  let events = $state(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let error = $state(/** @type {string | null} */ (null));
  let lastLoadedCommunityId = $state(/** @type {string | null} */ (null));

  // Initialize event loader composable
  const eventLoaderComposable = useCalendarEventLoader({
    onEventsUpdate: (newEvents) => {
      events = newEvents;
    },
    onLoadingChange: (loading) => {
      isLoading = loading;
    },
    onError: (errorMsg) => {
      error = errorMsg;
    }
  });

  // Function to load events for a community
  function loadEvents() {
    if (!communityId) {
      events = [];
      isLoading = false;
      error = null;
      lastLoadedCommunityId = null;
      return;
    }

    // Skip if already loading this community
    if (communityId === lastLoadedCommunityId) {
      return;
    }

    lastLoadedCommunityId = communityId;
    eventLoaderComposable.loadByCommunity(communityId);
  }

  // Watch for communityId changes
  $effect(() => {
    // Track communityId as dependency
    const _currentId = communityId;
    loadEvents();
  });

  // Setup and cleanup
  onMount(() => {
    // Cleanup on unmount
    return () => {
      eventLoaderComposable.cleanup();
    };
  });

  // Count unique valid calendar events (filter out invalid events)
  // Note: events are transformed CalendarEvent objects, validation needs original Nostr events
  const validEvents = $derived(filterValidEvents(events.map((e) => e.originalEvent)));
  const eventCount = $derived(validEvents.length);
</script>

<div class="stat rounded-lg bg-base-100">
  <div class="stat-figure text-secondary">
    <CalendarIcon class_="w-8 h-8" />
  </div>
  <div class="stat-title">{m.community_stats_calendar_events_title()}</div>
  {#if isLoading}
    <div class="stat-value text-secondary">
      <span class="loading loading-sm loading-spinner"></span>
    </div>
    <div class="stat-desc text-xs opacity-70">{m.community_stats_calendar_events_loading()}</div>
  {:else if error}
    <div class="stat-value text-error">
      <svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </div>
    <div class="stat-desc text-xs text-error">{m.community_stats_calendar_events_error()}</div>
  {:else}
    <div class="stat-value text-secondary">{eventCount}</div>
    <div class="stat-desc">{m.community_stats_calendar_events_description()}</div>
  {/if}
</div>
