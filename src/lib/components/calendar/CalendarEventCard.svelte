<!--
  CalendarEventCard Component
  Displays individual calendar events in a card format
  Unified component used in both CalendarGrid and CalendarEventsList
-->

<script>
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate, formatRelativeTime } from '../../helpers/calendar.js';
  import EventTags from './EventTags.svelte';
  import LocationLink from '../shared/LocationLink.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import AttendeeIndicator from './AttendeeIndicator.svelte';
  import { useCalendarEventRsvps } from '$lib/stores/calendar-event-rsvps.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { transformRsvps } from '$lib/helpers/rsvpUtils.js';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import { createCommentLoaderForEvent } from '$lib/loaders/comments.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { RepliesModel } from 'applesauce-common/models';
  import { ChatIcon } from '$lib/components/icons';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';

  /**
   * @typedef {import('../../types/calendar.js').CalendarEvent} CalendarEvent
   */

  /** @type {{ event: any, compact?: boolean, variant?: 'card' | 'list', authorProfile?: any, onEventClick?: ((event: any) => void) | null }} */
  let {
    event,
    compact = false,
    variant = 'card',
    authorProfile = null,
    onEventClick = null
  } = $props();

  const isList = $derived(variant === 'list');

  // Author display name
  const authorName = $derived(
    authorProfile
      ? getDisplayName(authorProfile, event.originalEvent?.pubkey?.slice(0, 8) + '...')
      : null
  );

  // Generate naddr for internal navigation (when onEventClick is not provided)
  const eventNaddr = $derived.by(() => {
    const raw = event.originalEvent;
    if (!raw) return null;
    return encodeEventToNaddr(raw);
  });

  // Load RSVPs for this event (called at component init, not inside $derived)
  // svelte-ignore state_referenced_locally
  const rsvpData = event.originalEvent
    ? useCalendarEventRsvps(event.originalEvent)
    : { rsvps: [], loading: false };

  // Get current user pubkey
  const userPubkey = $derived(manager.active?.pubkey || null);

  // Transform raw RSVPs into grouped data using helper
  const transformedRsvps = $derived(transformRsvps(rsvpData.rsvps, userPubkey));

  // Format event times for display
  // event.start and event.end are now UNIX timestamps (seconds) from applesauce helpers
  let startDate = $derived(new Date(event.start * 1000));
  let endDate = $derived(event.end ? new Date(event.end * 1000) : null);
  let isAllDay = $derived(event.kind === 31922); // Date-based events are all-day
  let isMultiDay = $derived(endDate && startDate.toDateString() !== endDate.toDateString());

  let commentCount = $state(0);

  // Fetch comments from relays + subscribe to RepliesModel for reactive counts
  $effect(() => {
    const rawEvent = event.originalEvent;
    if (!rawEvent?.id) return;

    const loader = createCommentLoaderForEvent(rawEvent);
    const loaderSub = loader().subscribe();
    const modelSub = eventStore.model(RepliesModel, rawEvent).subscribe((replies) => {
      commentCount = (replies || []).length;
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /**
   * @param {Event} e
   */
  function handleClick(e) {
    e.stopPropagation();
    if (onEventClick) {
      onEventClick(event);
    } else if (eventNaddr) {
      goto(resolve(`/calendar/event/${eventNaddr}`));
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  }
</script>

{#if isList}
  <!-- List variant: horizontal row -->
  <div
    class="calendar-event-card-list focus:ring-opacity-50 flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 transition-shadow hover:shadow-sm focus:ring-2 focus:ring-primary focus:outline-none {isAllDay
      ? 'border-l-4 border-l-info'
      : ''} {isMultiDay ? 'border-l-4 border-l-secondary' : ''}"
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleKeydown}
    data-testid="calendar-event-card"
  >
    <div
      class="list-thumbnail h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-base-200 sm:h-20 sm:w-20"
    >
      {#if event.image}
        <ImageWithFallback
          src={event.image}
          alt={event.title}
          fallbackType="event"
          size="thumbnail"
          class="h-full w-full object-cover"
        />
      {:else}
        <div class="flex h-full w-full items-center justify-center text-2xl text-base-content/30">
          📅
        </div>
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate font-semibold text-base-content">{event.title}</div>
      <div class="truncate text-sm text-base-content/60">
        {formatCalendarDate(startDate, 'short')}
        {#if isMultiDay && endDate}
          - {formatCalendarDate(endDate, 'short')}
        {/if}
        {#if !isAllDay}
          · {formatCalendarDate(startDate, 'time')}
          {#if endDate}
            - {formatCalendarDate(endDate, 'time')}
          {/if}
        {:else}
          · {m.event_card_all_day()}
        {/if}
      </div>
      {#if event.locations && event.locations.length > 0}
        <div class="truncate text-sm text-base-content/50">
          📍 {event.locations[0].name || event.locations[0].address || ''}
        </div>
      {:else if event.summary}
        <div class="truncate text-sm text-base-content/50">{event.summary}</div>
      {/if}
    </div>
  </div>
{:else}
  <div
    class="calendar-event-card focus:ring-opacity-50 w-full max-w-full cursor-pointer rounded-lg border border-base-300 bg-base-100 shadow-sm transition-shadow hover:shadow-md focus:ring-2 focus:ring-primary focus:outline-none {compact
      ? 'p-2 text-sm'
      : 'p-4'} {isAllDay ? 'border-l-4 border-l-info' : ''} {isMultiDay
      ? 'border-l-4 border-l-secondary'
      : ''}"
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleKeydown}
    data-testid="calendar-event-card"
  >
    <!-- Author Header (shown when authorProfile provided and not compact) -->
    {#if authorProfile && !compact}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="mb-3 flex items-center gap-3" onclick={(e) => e.stopPropagation()}>
        <ProfileAvatar
          pubkey={event.originalEvent?.pubkey}
          profile={authorProfile}
          size="md"
          linkToProfile
          fallbackType="robohash"
        />
        <div class="min-w-0 flex-1">
          <span class="truncate font-medium text-base-content">{authorName}</span>
          <div class="text-sm text-base-content/60">
            {formatRelativeTime(event.createdAt || event.originalEvent?.created_at)}
          </div>
        </div>
      </div>
    {/if}

    <div class="flex flex-col gap-3 overflow-hidden lg:flex-row">
      <!-- Event Image (full mode only) -->
      {#if event.image && !compact}
        <div class="w-full lg:w-auto lg:flex-shrink-0">
          <div class="aspect-[5/2] w-full lg:aspect-square lg:w-20">
            <ImageWithFallback
              src={event.image}
              alt={event.title}
              fallbackType="event"
              size="card"
              class="h-full w-full max-w-full rounded-lg object-cover"
            />
          </div>
        </div>
      {/if}

      <!-- Content area -->
      <div class="min-w-0 flex-1 overflow-hidden">
        <!-- Event Title -->
        <div
          class="font-semibold text-base-content {compact
            ? 'mb-0 truncate text-xs font-medium'
            : 'mb-2 line-clamp-2 text-base'}"
        >
          {event.title}
        </div>

        <!-- Event Date and Time -->
        {#if !compact}
          <!-- Mobile: Stacked layout -->
          <div class="mb-2 flex flex-col gap-1 text-sm text-base-content/70 lg:hidden">
            <!-- Date -->
            <div class="flex items-center gap-1">
              <span class="text-xs">📅</span>
              <span>
                {formatCalendarDate(startDate, 'short')}
                {#if isMultiDay && endDate}
                  - {formatCalendarDate(endDate, 'short')}
                {/if}
              </span>
            </div>

            <!-- Time -->
            <div class="flex items-center gap-1">
              <span class="text-xs">🕐</span>
              <span>
                {#if isAllDay}
                  {m.event_card_all_day()}
                {:else}
                  {formatCalendarDate(startDate, 'time')}
                  {#if endDate}
                    - {formatCalendarDate(endDate, 'time')}
                  {/if}
                {/if}
              </span>
            </div>
          </div>

          <!-- Desktop: Horizontal layout -->
          <div class="mb-2 hidden items-center gap-4 text-sm text-base-content/70 lg:flex">
            <!-- Date -->
            <div class="flex items-center gap-1">
              <span class="text-xs">📅</span>
              <span>
                {formatCalendarDate(startDate, 'short')}
                {#if isMultiDay && endDate}
                  - {formatCalendarDate(endDate, 'short')}
                {/if}
              </span>
            </div>

            <!-- Time -->
            <div class="flex items-center gap-1">
              <span class="text-xs">🕐</span>
              <span>
                {#if isAllDay}
                  {m.event_card_all_day()}
                {:else}
                  {formatCalendarDate(startDate, 'time')}
                  {#if endDate}
                    - {formatCalendarDate(endDate, 'time')}
                  {/if}
                {/if}
              </span>
            </div>
          </div>
        {:else}
          <!-- Compact time display -->
          {#if !isAllDay}
            <div class="mb-1 text-xs text-base-content/70">
              {formatCalendarDate(startDate, 'time')}
              {#if endDate}
                - {formatCalendarDate(endDate, 'time')}
              {/if}
            </div>
          {/if}

          <!-- Compact date display for multi-day -->
          {#if isMultiDay}
            <div class="mb-1 text-xs text-base-content/50">
              {formatCalendarDate(startDate, 'short')}
              {#if endDate}
                - {formatCalendarDate(endDate, 'short')}
              {/if}
            </div>
          {/if}
        {/if}

        <!-- Event Location -->
        {#if event.locations && event.locations.length > 0 && !compact}
          <div class="mb-2 flex items-center gap-1 overflow-hidden text-sm text-base-content/70">
            <span class="flex-shrink-0 text-xs">📍</span>
            <div class="min-w-0 flex-1">
              <LocationLink location={event.locations[0]} />
            </div>
            {#if event.locations.length > 1}
              <span class="ml-1 flex-shrink-0 text-xs text-base-content/40"
                >+{event.locations.length - 1}</span
              >
            {/if}
          </div>
        {/if}

        <!-- Event Summary (full mode only) -->
        {#if event.summary && !compact}
          <MarkdownRenderer
            content={event.summary}
            class="mb-3 line-clamp-2 text-sm break-words text-base-content/80"
          />
        {/if}

        <!-- Event Type Badge and Creation Date (full mode only) -->
        {#if !compact}
          <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-base-content/60">
            <span class="badge badge-outline badge-xs">
              {event.kind === 31922 ? m.event_card_date_event() : m.event_card_time_event()}
            </span>
            {#if event.createdAt}
              <div class="text-xs text-base-content/50">
                <span
                  >{m.event_card_created()}
                  {formatCalendarDate(new Date(event.createdAt * 1000), 'short')}</span
                >
              </div>
            {/if}
          </div>
        {/if}

        <!-- Event Tags (clickable) - Only show in full mode -->
        {#if event.hashtags && event.hashtags.length > 0 && !compact}
          <div class="mb-2 overflow-hidden">
            <EventTags tags={event.hashtags} size="sm" />
          </div>
        {/if}

        <!-- Attendee Indicator (replaces old RSVP count) -->
        {#if !compact && transformedRsvps.totalCount > 0}
          <div class="mb-3">
            <AttendeeIndicator
              accepted={transformedRsvps.accepted}
              tentative={transformedRsvps.tentative}
              declined={transformedRsvps.declined}
              totalCount={transformedRsvps.totalCount}
              compact={true}
            />
          </div>
        {/if}

        <!-- Reactions & Comments -->
        {#if !compact}
          <div class="mt-2 flex items-center gap-2">
            {#if commentCount > 0}
              <span class="flex items-center gap-1 text-sm text-base-content/60">
                <ChatIcon class_="w-4 h-4" />
                {commentCount}
              </span>
            {/if}
            <ReactionBar event={event.originalEvent || event} />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
