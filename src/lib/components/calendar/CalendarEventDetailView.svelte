<!--
  CalendarEventDetailView Component
  Renders the detail body for a calendar event (kinds 31922 / 31923).
  Shared between the global /calendar/event/[naddr] route and the community-scoped
  /c/[pubkey]/event/[naddr] route so the community sidebar persists when entering
  the detail view from a community feed card.
-->

<script>
  import { resolve } from '$app/paths';
  import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import {
    CalendarIcon,
    ClockIcon,
    LocationIcon,
    UserIcon,
    ExternalLinkIcon
  } from '$lib/components/icons';
  import DetailHeader from '$lib/components/shared/DetailHeader.svelte';
  import MarkdownRenderer from '$lib/components/shared/MarkdownRenderer.svelte';
  import AddToCalendarDropdown from '$lib/components/calendar/AddToCalendarDropdown.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import { deleteCalendarEvent } from '$lib/helpers/eventDeletion.js';
  import EventTags from '$lib/components/calendar/EventTags.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import LocationLink from '$lib/components/shared/LocationLink.svelte';
  import EventLocationMap from '$lib/components/calendar/EventLocationMap.svelte';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import InlineRsvp from '$lib/components/calendar/InlineRsvp.svelte';
  import AttendeeIndicator from '$lib/components/calendar/AttendeeIndicator.svelte';
  import { useCalendarEventRsvps } from '$lib/stores/calendar-event-rsvps.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { transformRsvps } from '$lib/helpers/rsvpUtils.js';
  import * as m from '$lib/paraglide/messages';
  import HeroImage from '$lib/components/shared/HeroImage.svelte';

  /**
   * @typedef {Object} Props
   * @property {any} event - Calendar event metadata (formatted)
   * @property {any} [rawEvent] - The original signed Nostr event
   */

  /** @type {Props} */
  let { event, rawEvent = null } = $props();

  /**
   * Get calendar relays from app config
   * @returns {string[]}
   */
  function getCalendarRelays() {
    return [...(runtimeConfig.appRelays?.calendar || []), ...(runtimeConfig.fallbackRelays || [])];
  }

  // Use the proper reactive hook for active user
  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());

  // Reactive state
  let featuredCalendars = $state(/** @type {any[]} */ ([]));
  let isLoadingCalendars = $state(true);

  // Check if user owns this event
  let isUserEvent = $derived(event && activeUser && event.pubkey === activeUser.pubkey);

  // Format event data for display
  let startDate = $derived(event ? new Date(event.start * 1000) : null);
  let endDate = $derived(event && event.end ? new Date(event.end * 1000) : null);
  let isAllDay = $derived(event ? event.kind === 31922 : false);
  let isMultiDay = $derived(
    event && endDate && startDate ? startDate.toDateString() !== endDate.toDateString() : false
  );

  // Generate event address for featured calendars
  let eventAddress = $derived.by(() => {
    if (!event) return null;
    if (event.kind >= 30000 && event.kind < 40000) {
      return `${event.kind}:${event.pubkey}:${event.dTag}`;
    }
    return `${event.kind}:${event.pubkey}:${event.id}`;
  });

  // Load RSVPs for this event
  const rsvpData = $derived(
    rawEvent ? useCalendarEventRsvps(rawEvent) : { rsvps: [], loading: false }
  );

  // Get current user pubkey
  const userPubkey = $derived(manager.active?.pubkey || null);

  // Transform raw RSVPs into grouped data using helper
  const transformedRsvps = $derived(transformRsvps(rsvpData.rsvps, userPubkey));

  // Subscribe to featured calendars
  $effect(() => {
    if (!eventAddress) return;

    isLoadingCalendars = true;

    // Query for calendars (kind 31924) that reference this event.
    // v6: request() completes after EOSE (or timeout) and emits only events.
    const subscription = pool
      .group(getCalendarRelays())
      .request({ kinds: [31924], '#a': [eventAddress] }, { timeout: 10_000 })
      .subscribe({
        next: (event) => {
          if (event?.kind !== 31924) return;

          // Add to eventStore
          eventStore.add(event);

          // Add to featured calendars if not already present
          const existingIndex = featuredCalendars.findIndex((c) => c.id === event.id);
          if (existingIndex === -1) {
            featuredCalendars = [...featuredCalendars, event];
          }
        },
        error: (error) => {
          console.error('Calendar request error:', error);
          isLoadingCalendars = false;
        },
        complete: () => {
          isLoadingCalendars = false;
        }
      });

    return () => subscription.unsubscribe();
  });

  /**
   * Get calendar title
   * @param {any} calendar
   */
  function getCalendarTitle(calendar) {
    const titleTag = calendar.tags.find((/** @type {string[]} */ t) => t[0] === 'title');
    return titleTag?.[1] || 'Untitled Calendar';
  }

  /**
   * Generate naddr for calendar
   * @param {any} calendar
   */
  function getCalendarNaddr(calendar) {
    return encodeEventToNaddr(calendar, []);
  }

  /**
   * Handle edit action - open edit modal
   */
  function handleEdit() {
    if (!event || !rawEvent) return;
    modalStore.openModal('calendarEvent', {
      mode: 'edit',
      existingEvent: event,
      existingRawEvent: rawEvent,
      communityPubkey: event.pubkey
    });
  }

  /**
   * Handle delete action - delete and navigate back
   */
  async function handleDelete() {
    if (!activeUser || !event) return;
    const result = await deleteCalendarEvent(event, activeUser);
    if (result.success) {
      showToast(m.event_management_delete_success(), 'success');
      window.history.back();
    } else {
      showToast(result.error || m.event_management_delete_failed(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
  }
</script>

{#if event}
  <DetailHeader
    title={event.title || ''}
    event={rawEvent || {
      id: '',
      kind: event.kind || 31923,
      pubkey: event.pubkey || '',
      tags: [],
      created_at: 0,
      content: '',
      sig: ''
    }}
    authorPubkey={event.pubkey || ''}
    onEdit={isUserEvent ? handleEdit : undefined}
    onDelete={isUserEvent ? handleDelete : undefined}
    deleteTitle={m.event_management_delete_confirm_title()}
    deleteItemName={event.title || ''}
  >
    {#snippet actions()}
      <AddToCalendarDropdown {event} disabled={!activeUser} />
    {/snippet}
    {#snippet metadata()}
      {#if event.hashtags?.length > 0}
        <EventTags tags={event.hashtags} size="xs" maxDisplay={3} />
      {/if}
    {/snippet}
  </DetailHeader>

  <!-- Event Header with Image — full ratio, never cropped (#29) -->
  {#if event.image}
    <div class="mb-4">
      <HeroImage src={event.image} alt={event.title} fallbackType="event" />
    </div>
  {/if}

  <!-- Description -->
  {#if event.summary}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">{m.calendar_event_description()}</h2>
        <MarkdownRenderer content={event.summary} class="prose mt-2 max-w-none" />
      </div>
    </div>
  {/if}

  <!-- Date and Time Card -->
  <div class="card mb-8 bg-base-100 shadow-lg">
    <div class="card-body">
      <h2 class="card-title text-2xl">
        <CalendarIcon class_="w-6 h-6" />
        {m.calendar_detail_date_time()}
      </h2>

      {#if isAllDay}
        <div class="mt-4 space-y-2">
          <div class="flex items-center gap-3">
            <CalendarIcon class_="w-5 h-5 text-info" />
            <span class="font-semibold">{m.calendar_detail_all_day()}</span>
          </div>
          <div class="ml-8 text-base-content/70">
            {#if isMultiDay && endDate && startDate}
              {formatCalendarDate(startDate, 'long')} - {formatCalendarDate(endDate, 'long')}
            {:else if startDate}
              {formatCalendarDate(startDate, 'long')}
            {/if}
          </div>
        </div>
      {:else}
        <div class="mt-4 space-y-3">
          {#if startDate}
            <div class="flex items-start gap-3">
              <ClockIcon class_="w-5 h-5 text-primary mt-0.5" />
              <div>
                <div class="font-semibold">{m.calendar_detail_start()}</div>
                <div class="text-base-content/80">
                  {formatCalendarDate(startDate, 'long')} at {formatCalendarDate(startDate, 'time')}
                  {#if event.startTimezone}
                    <span class="text-sm text-base-content/60">({event.startTimezone})</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
          {#if endDate}
            <div class="flex items-start gap-3">
              <ClockIcon class_="w-5 h-5 text-secondary mt-0.5" />
              <div>
                <div class="font-semibold">{m.calendar_detail_end()}</div>
                <div class="text-base-content/80">
                  {formatCalendarDate(endDate, 'long')} at {formatCalendarDate(endDate, 'time')}
                  {#if event.endTimezone}
                    <span class="text-sm text-base-content/60">({event.endTimezone})</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Event Author Card -->
  <div class="card mb-8 bg-base-100 shadow-lg">
    <div class="card-body">
      <h2 class="card-title text-2xl">
        <UserIcon class_="w-6 h-6" />
        {m.calendar_detail_author()}
      </h2>
      <div class="mt-4">
        <ProfileCard pubkey={event.pubkey} size="lg" class="bg-base-100" />
      </div>
    </div>
  </div>

  <!-- Location Card -->
  {#if event.location}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">
          <LocationIcon class_="w-6 h-6" />
          {m.calendar_event_location()}
        </h2>
        <div class="mt-4">
          <div class="flex items-start gap-3">
            <LocationIcon class_="w-5 h-5 mt-0.5" />
            <div class="text-base-content/80">
              <LocationLink location={event.location} />
            </div>
          </div>

          <!-- Map Preview -->
          <div class="mt-4">
            <EventLocationMap location={event.location} geohash={event.geohash} compact={true} />
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Event Tags -->
  {#if event.hashtags && event.hashtags.length > 0}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">{m.calendar_detail_tags()}</h2>
        <div class="mt-4">
          <EventTags tags={event.hashtags} size="lg" />
        </div>
      </div>
    </div>
  {/if}

  <!-- Further Links -->
  {#if event.references && event.references.length > 0}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">{m.calendar_detail_links()}</h2>
        <div class="mt-4 space-y-2">
          {#each event.references as reference (reference)}
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: event reference URL -->
            <a
              href={reference}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-2 rounded-lg bg-base-100 p-4 transition hover:bg-base-300"
            >
              <ExternalLinkIcon class_="w-5 h-5 text-base-content/60" />
              <span class="break-all text-base-content/80">{reference}</span>
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- Featured in Calendars -->
  <div class="card mb-8 bg-base-100 shadow-lg">
    <div class="card-body">
      <h2 class="card-title text-2xl">{m.calendar_detail_featured_calendars()}</h2>
      {#if isLoadingCalendars}
        <div class="mt-4 flex items-center gap-2">
          <span class="loading loading-sm loading-spinner"></span>
          <span class="text-base-content/70">{m.calendar_detail_loading_calendars()}</span>
        </div>
      {:else if featuredCalendars.length > 0}
        <div class="mt-4 space-y-2">
          {#each featuredCalendars as calendar (calendar.id)}
            <a
              href={resolve(`/calendar/${getCalendarNaddr(calendar)}`)}
              class="block rounded-lg bg-base-100 p-4 transition hover:bg-base-300"
            >
              <div class="font-semibold text-primary">{getCalendarTitle(calendar)}</div>
              {#if calendar.content}
                <div class="mt-1 text-sm text-base-content/70">{calendar.content}</div>
              {/if}
            </a>
          {/each}
        </div>
      {:else}
        <div class="mt-4 text-center text-base-content/60">
          {m.calendar_detail_no_calendars()}
        </div>
      {/if}
    </div>
  </div>

  <!-- Event Participants -->
  {#if event.participants && event.participants.length > 0}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">
          <UserIcon class_="w-6 h-6" />
          Participant{#if event.participants.length > 1}s{/if}
        </h2>
        <div class="mt-4 space-y-2">
          {#each event.participants as participant (participant.pubkey)}
            <div class="rounded-lg bg-base-100 p-3">
              <ProfileCard
                pubkey={participant.pubkey}
                showNpub={false}
                class="bg-transparent p-0"
              />
              {#if participant.role}
                <div class="mt-2 flex items-center gap-2">
                  <span class="badge badge-sm badge-primary">{participant.role}</span>
                </div>
              {/if}
              {#if participant.relay}
                <div class="mt-1 text-xs text-base-content/50">
                  Relay: {participant.relay}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <!-- RSVP Section -->
  <div class="card mb-8 bg-base-100 shadow-lg">
    <div class="card-body">
      <div class="flex items-center justify-between">
        <h2 class="card-title text-2xl">
          <UserIcon class_="w-6 h-6" />
          {m.calendar_detail_rsvp_title()}
        </h2>
        {#if activeUser && rawEvent}
          <button
            class="btn btn-outline btn-sm"
            onclick={() => modalStore.openModal('inviteToEvent', { rawEvent })}
          >
            {m.event_invite_button()}
          </button>
        {/if}
      </div>
      <div class="mt-4">
        <InlineRsvp
          calendarEvent={rawEvent || event}
          communityPubkey={event?.communityPubkey || ''}
          size="lg"
          showNote={false}
          compact={false}
        />
        <p class="mt-3 text-sm text-base-content/60">
          {m.calendar_detail_rsvp_help()}
        </p>
      </div>
    </div>
  </div>

  <!-- Attendees/RSVP Section (New) -->
  {#if transformedRsvps.totalCount > 0}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <AttendeeIndicator
          accepted={transformedRsvps.accepted}
          tentative={transformedRsvps.tentative}
          declined={transformedRsvps.declined}
          totalCount={transformedRsvps.totalCount}
          compact={false}
        />
      </div>
    </div>
  {/if}

  <!-- Reactions Section -->
  {#if rawEvent}
    <div class="card mb-8 bg-base-100 shadow-lg">
      <div class="card-body">
        <h2 class="card-title text-2xl">{m.calendar_detail_reactions()}</h2>
        <div class="mt-4">
          <ReactionBar event={rawEvent} relays={getCalendarRelays()} />
        </div>
      </div>
    </div>
  {/if}

  <!-- Comments Section -->
  {#if rawEvent}
    <CommentList rootEvent={rawEvent} {activeUser} />
  {/if}
{:else}
  <div class="alert alert-error">
    <span>{m.calendar_detail_not_found()}</span>
  </div>
{/if}
