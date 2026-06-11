<!--
  SimpleCalendarEventsList Component
  Simple list view of calendar events that accepts events as props
  Paginates display with Show More buttons to avoid rendering hundreds of cards
-->

<script>
  import { CalendarIcon, AlertIcon, ChevronDownIcon } from '$lib/components/icons';
  import { filterEventsByViewMode } from '$lib/helpers/calendar.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import * as m from '$lib/paraglide/messages';

  // Import existing UI components
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';

  /**
   * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
   * @typedef {import('$lib/types/calendar.js').CalendarViewMode} CalendarViewMode
   */

  const PAGE_SIZE = 20;

  // Props
  let {
    events = /** @type {CalendarEvent[]} */ ([]),
    viewMode = /** @type {CalendarViewMode} */ ('month'),
    currentDate = new Date(),
    loading = false,
    error = /** @type {string | null} */ (null)
  } = $props();

  // Display limits for pagination
  let upcomingDisplayLimit = $state(PAGE_SIZE);
  let pastDisplayLimit = $state(PAGE_SIZE);

  // Filter events based on current view mode and date using shared helper
  let filteredEvents = $derived.by(() => filterEventsByViewMode(events, viewMode, currentDate));

  // Reset display limits when filtered events change (view/date navigation)
  $effect(() => {
    // Track filteredEvents reference to detect changes
    const _ = filteredEvents;
    upcomingDisplayLimit = PAGE_SIZE;
    pastDisplayLimit = PAGE_SIZE;
  });

  // Current timestamp for comparison
  let now = $derived(Date.now());

  // Upcoming events (start time is in the future)
  let upcomingEvents = $derived.by(() => {
    return filteredEvents.filter((/** @type {CalendarEvent} */ event) => event.start * 1000 >= now);
    // Already sorted chronologically (earliest first) from filteredEvents
  });

  // Past events (start time is in the past)
  let pastEvents = $derived.by(() => {
    const past = filteredEvents.filter(
      (/** @type {CalendarEvent} */ event) => event.start * 1000 < now
    );
    // Sort in reverse chronological order (most recent first)
    return past.reverse();
  });

  // Paginated slices
  let displayedUpcoming = $derived(upcomingEvents.slice(0, upcomingDisplayLimit));
  let displayedPast = $derived(pastEvents.slice(0, pastDisplayLimit));

  let hasMoreUpcoming = $derived(upcomingEvents.length > upcomingDisplayLimit);
  let hasMorePast = $derived(pastEvents.length > pastDisplayLimit);

  // Batch-load author profiles for currently-visible cards (non-compact variants
  // render an author header; see CalendarEventCard.svelte).
  const getAuthorProfiles = useProfileMap(() =>
    [...displayedUpcoming, ...displayedPast]
      .map((/** @type {CalendarEvent} */ e) => e.originalEvent?.pubkey)
      .filter(Boolean)
  );
  let authorProfiles = $derived(getAuthorProfiles());

  /**
   * Scroll to past events section
   */
  function scrollToPastEvents() {
    const element = document.getElementById('past-events');
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Scroll back to top
   */
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<div class="space-y-4">
  <!-- Error Display -->
  {#if error}
    <div class="alert alert-error">
      <AlertIcon class_="h-5 w-5" />
      <span>{error}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => (error = null)}>
        {m.events_list_dismiss()}
      </button>
    </div>
  {/if}

  <!-- Upcoming Events Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-base-content">
        {m.events_list_upcoming_header({ count: upcomingEvents.length })}
      </h3>
      {#if pastEvents.length > 0}
        <button
          type="button"
          onclick={scrollToPastEvents}
          class="flex link items-center gap-1 text-sm link-primary link-hover"
          aria-label={m.aria_jump_past_events()}
        >
          <span>{m.events_list_jump_to_past({ count: pastEvents.length })}</span>
          <ChevronDownIcon class_="h-4 w-4" />
        </button>
      {/if}
    </div>

    {#if upcomingEvents.length > 0}
      <div class="flex max-w-full flex-col gap-4 overflow-hidden">
        {#each displayedUpcoming as event (event.id)}
          <CalendarEventCard
            {event}
            compact={false}
            authorProfile={authorProfiles.get(event.originalEvent?.pubkey)}
          />
        {/each}
      </div>
      {#if hasMoreUpcoming}
        <div class="text-center">
          <button
            type="button"
            class="btn btn-outline btn-sm btn-primary"
            onclick={() => (upcomingDisplayLimit += PAGE_SIZE)}
          >
            {m.events_list_show_more({ remaining: upcomingEvents.length - upcomingDisplayLimit })}
          </button>
        </div>
      {/if}
    {:else if !loading}
      <!-- Empty State for Upcoming Events -->
      <div class="py-8 text-center">
        <div class="mb-3 text-base-content/30">
          <CalendarIcon class_="h-12 w-12 mx-auto" />
        </div>
        <p class="text-base-content/60">{m.events_list_upcoming_empty()}</p>
      </div>
    {/if}
  </section>

  <!-- Divider -->
  {#if filteredEvents.length > 0}
    <div class="divider"></div>
  {/if}

  <!-- Past Events Section -->
  <section id="past-events" class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-base-content">
        {m.events_list_past_header({ count: pastEvents.length })}
      </h3>
      <button
        type="button"
        onclick={scrollToTop}
        class="flex link items-center gap-1 text-sm link-primary link-hover"
        aria-label={m.aria_back_to_top()}
      >
        <ChevronDownIcon class_="h-4 w-4 rotate-180" />
        <span>{m.events_list_back_to_top()}</span>
      </button>
    </div>

    {#if pastEvents.length > 0}
      <div class="flex max-w-full flex-col gap-4 overflow-hidden">
        {#each displayedPast as event (event.id)}
          <CalendarEventCard
            {event}
            compact={false}
            authorProfile={authorProfiles.get(event.originalEvent?.pubkey)}
          />
        {/each}
      </div>
      {#if hasMorePast}
        <div class="text-center">
          <button
            type="button"
            class="btn btn-outline btn-sm btn-primary"
            onclick={() => (pastDisplayLimit += PAGE_SIZE)}
          >
            {m.events_list_show_more({ remaining: pastEvents.length - pastDisplayLimit })}
          </button>
        </div>
      {/if}
    {:else if !loading}
      <!-- Empty State for Past Events -->
      <div class="py-8 text-center">
        <div class="mb-3 text-base-content/30">
          <CalendarIcon class_="h-12 w-12 mx-auto" />
        </div>
        <p class="text-base-content/60">{m.events_list_past_empty()}</p>
      </div>
    {/if}
  </section>

  <!-- Global Empty State (when no events at all) -->
  {#if filteredEvents.length === 0 && !loading}
    <div class="py-12 text-center">
      <div class="mb-4 text-base-content/30">
        <CalendarIcon class_="h-16 w-16 mx-auto" />
      </div>
      <h3 class="mb-2 text-lg font-medium text-base-content">
        {m.events_list_global_empty_title()}
      </h3>
      <p class="text-base-content/60">{m.events_list_global_empty_description()}</p>
    </div>
  {/if}

  <!-- Loading indicator -->
  {#if loading && filteredEvents.length === 0}
    <div class="py-12 text-center">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.events_list_loading()}</p>
    </div>
  {/if}
</div>
