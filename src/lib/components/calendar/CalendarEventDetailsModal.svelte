<!--
  CalendarEventDetailsModal Component
  Modal for displaying calendar event details in read-only format
-->

<script>
  import { SvelteDate } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { formatCalendarDate } from '../../helpers/calendar.js';
  import { modalStore } from '../../stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import {
    CloseIcon,
    CalendarIcon,
    ClockIcon,
    LocationIcon,
    ExternalLinkIcon,
    CopyIcon
  } from '$lib/components/icons';
  import EventDebugInfo from './EventDebugInfo.svelte';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import LocationLink from '../shared/LocationLink.svelte';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import PersonalCalendarShare from './PersonalCalendarShare.svelte';
  import CommunityShare from '../shared/CommunityShare.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import ProfileCard from '../shared/ProfileCard.svelte';
  import EventManagementActions from './EventManagementActions.svelte';
  import EventContextMenu from '../shared/EventContextMenu.svelte';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';

  /**
   * @typedef {import('../../types/calendar.js').CalendarEvent} CalendarEvent
   */

  // Get modal store
  const modal = modalStore;

  // Note: We read manager.active directly in derived values and templates
  // to avoid $state/$effect mutation loops. The manager is already wrapped
  // in $state in accounts.svelte.js, so reactivity is preserved.

  // Generate unique modal ID
  const modalId = 'event-details-modal';

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Only update store if this modal is currently active
      if (modal.activeModal === 'eventDetails') {
        console.log('CalendarEventDetailsModal: Dialog closed, syncing with store');
        modal.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  // Reactive effect to handle modal opening/closing
  $effect(() => {
    const currentModal = modal.activeModal;
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));

    if (currentModal === 'eventDetails' && dialog && !dialog.open) {
      console.log('CalendarEventDetailsModal: Opening event details modal');
      dialog.showModal();
    } else if (currentModal !== 'eventDetails' && dialog && dialog.open) {
      console.log('CalendarEventDetailsModal: Closing event details modal');
      dialog.close();
    }
  });

  // Get event from modal props
  let event = $derived(
    modal.modalProps && /** @type {any} */ (modal.modalProps).event
      ? /** @type {any} */ (modal.modalProps).event
      : null
  );

  // Format event data for display
  let startDate = $derived(event ? new Date(event.start * 1000) : null);
  let endDate = $derived(event && event.end ? new Date(event.end * 1000) : null);
  let isAllDay = $derived(event ? event.kind === 31922 : false);
  let isMultiDay = $derived(
    event && endDate && startDate ? startDate.toDateString() !== endDate.toDateString() : false
  );

  // Check if user owns this event
  let isUserEvent = $derived(event && manager.active && event.pubkey === manager.active.pubkey);

  // Generate URL for event detail page
  let eventDetailUrl = $derived(
    event?.originalEvent ? `/calendar/event/${encodeEventToNaddr(event.originalEvent)}` : ''
  );

  /**
   * Handle backdrop click
   * @param {MouseEvent} e
   */
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }

  /**
   * Handle escape key
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  /**
   * Copy event naddr to clipboard
   */
  async function copyNaddr() {
    if (event?.originalEvent) {
      try {
        const naddr = encodeEventToNaddr(event.originalEvent);
        await navigator.clipboard.writeText(naddr);
        console.log('Event naddr copied to clipboard:', naddr);
        showToast(m.event_details_link_copied(), 'success');
      } catch (err) {
        console.error('Failed to copy event naddr:', err);
        showToast(m.event_details_copy_failed(), 'error');
      }
    }
  }

  /**
   * Handle edit action - navigate to event detail page
   */
  function handleEdit() {
    if (eventDetailUrl) {
      goto(resolve(eventDetailUrl));
    }
  }

  /**
   * Handle delete success - close modal
   */
  function handleDeleteSuccess() {
    modal.closeModal();
    // The event will be automatically removed from the calendar view
    // since eventStore.add() in deleteCalendarEvent removes it
  }

  /**
   * Handle modal close
   */
  function handleClose() {
    modal.closeModal();
  }

  /**
   * Get event type badge info
   * @returns {{ text: string, class: string }}
   */
  function getEventTypeBadge() {
    if (!event) return { text: '', class: '' };

    if (isAllDay) {
      if (isMultiDay) {
        return { text: m.event_details_multi_day(), class: 'badge-secondary' };
      }
      return { text: m.event_details_all_day(), class: 'badge-primary' };
    }
    return { text: m.event_details_timed_event(), class: 'badge-accent' };
  }

  /**
   * Get compact date string for header
   * @returns {string}
   */
  function getCompactDate() {
    if (!startDate) return '';

    const now = new SvelteDate();
    const today = new SvelteDate(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new SvelteDate(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const eventDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

    const timeStr = isAllDay ? '' : `, ${formatCalendarDate(startDate, 'time')}`;

    if (eventDay.getTime() === today.getTime()) {
      return `${m.event_details_today()}${timeStr}`;
    } else if (eventDay.getTime() === tomorrow.getTime()) {
      return `${m.event_details_tomorrow()}${timeStr}`;
    } else {
      const monthDay = formatCalendarDate(startDate, 'long').split(',')[0]; // Get "Dec 25" part
      return `${monthDay}${timeStr}`;
    }
  }

  // Derived values for header
  let eventTypeBadge = $derived(getEventTypeBadge());
  let compactDate = $derived(getCompactDate());
</script>

<!-- Event Details Modal -->
{#if modal.activeModal === 'eventDetails' && event}
  <dialog
    id={modalId}
    class="modal"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    aria-labelledby="event-title"
  >
    <div class="modal-box max-h-screen w-full max-w-2xl overflow-y-auto">
      <!-- Modal Header - Enhanced Design -->
      <div class="mb-6 rounded-lg bg-base-200/50 p-5 pb-4">
        <!-- Top Row: Badge, Date, and Actions -->
        <div class="mb-3 flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            {#if eventTypeBadge.text}
              <span class="badge {eventTypeBadge.class} badge-sm font-medium">
                {eventTypeBadge.text}
              </span>
            {/if}
            {#if compactDate}
              <span class="flex items-center gap-1.5 text-sm text-base-content/70">
                <ClockIcon class_="w-4 h-4" />
                {compactDate}
              </span>
            {/if}
          </div>

          <!-- Simplified Action Buttons -->
          <div class="flex items-center gap-1">
            {#if isUserEvent}
              <EventManagementActions
                {event}
                activeUser={manager.active}
                onEdit={handleEdit}
                onDeleteSuccess={handleDeleteSuccess}
              />
            {/if}
            {#if event?.originalEvent}
              <EventContextMenu event={event.originalEvent} />
            {/if}
            <a
              href={resolve(eventDetailUrl)}
              class="btn btn-ghost btn-sm"
              aria-label={m.event_details_open_in_new_tab()}
              title={m.event_details_open_in_new_tab()}
              onclick={handleClose}
            >
              <ExternalLinkIcon title={m.event_details_show_event()} class_="w-5 h-5" />
            </a>
            <button
              class="btn text-error btn-ghost btn-sm hover:bg-error hover:text-error-content"
              onclick={handleClose}
              aria-label={m.event_details_close()}
              title={m.event_details_close()}
            >
              <CloseIcon class_="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- Title with Copy Button -->
        <div class="mb-3 flex items-start gap-2">
          <h2 id="event-title" class="flex-1 text-3xl leading-tight font-bold text-base-content">
            {event.title}
          </h2>
          <button
            class="btn mt-1 btn-ghost btn-sm"
            onclick={copyNaddr}
            aria-label={m.event_details_copy_address()}
            title={m.event_details_copy_address()}
          >
            <CopyIcon class_="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Event Image -->
      {#if event.image}
        <div class="mb-6">
          <ImageWithFallback
            src={event.image}
            alt={event.title}
            fallbackType="event"
            size="banner"
            class="h-48 w-full rounded-lg object-cover"
          />
        </div>
      {/if}

      <!-- Event Author -->
      <div class="mb-6">
        <h3 class="mb-3 text-lg font-semibold text-base-content">
          {m.event_details_event_author()}
        </h3>
        <ProfileCard pubkey={event.pubkey} onClose={handleClose} />
      </div>

      <!-- Event Description -->
      {#if event.summary}
        <div class="mb-6">
          <h3 class="mb-2 text-lg font-semibold text-base-content">
            {m.calendar_event_description()}
          </h3>
          <MarkdownRenderer content={event.summary} class="prose max-w-none" />
        </div>
      {/if}

      <!-- Event Date and Time -->
      <div class="mb-6">
        <h3 class="mb-3 text-lg font-semibold text-base-content">{m.event_details_date_time()}</h3>
        <div class="rounded-lg bg-base-200 p-4">
          {#if isAllDay}
            <div class="mb-2 flex items-center gap-2">
              <CalendarIcon class_="w-5 h-5 text-info" />
              <span class="font-medium text-base-content">{m.event_details_all_day_event()}</span>
            </div>
            <div class="ml-7 text-base-content/70">
              {isMultiDay && endDate && startDate
                ? `${formatCalendarDate(startDate, 'long')} - ${formatCalendarDate(endDate, 'long')}`
                : startDate
                  ? formatCalendarDate(startDate, 'long')
                  : ''}
            </div>
          {:else}
            <div class="space-y-2">
              {#if startDate}
                <div class="flex items-center gap-2">
                  <ClockIcon class_="w-5 h-5 text-primary" />
                  <span class="font-medium text-base-content">{m.event_details_start()}</span>
                  <span class="text-base-content/80">
                    {formatCalendarDate(startDate, 'long')} at {formatCalendarDate(
                      startDate,
                      'time'
                    )}
                    {#if event.startTimezone}
                      <span class="text-xs text-base-content/60">({event.startTimezone})</span>
                    {/if}
                  </span>
                </div>
              {/if}
              {#if endDate}
                <div class="flex items-center gap-2">
                  <ClockIcon class_="w-5 h-5 text-secondary" />
                  <span class="font-medium text-base-content">{m.event_details_end()}</span>
                  <span class="text-base-content/80">
                    {formatCalendarDate(endDate, 'long')} at {formatCalendarDate(endDate, 'time')}
                    {#if event.endTimezone}
                      <span class="text-xs text-base-content/60">({event.endTimezone})</span>
                    {/if}
                  </span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Event Locations -->
      {#if event.locations && event.locations.length > 0}
        <div class="mb-6">
          <h3 class="mb-3 text-lg font-semibold text-base-content">
            {event.locations.length > 1 ? m.event_details_locations() : m.event_details_location()}
          </h3>
          <div class="space-y-2">
            {#each event.locations as location, index (index)}
              <div class="flex items-start gap-3 rounded-lg bg-base-200 p-3">
                <LocationIcon class_="w-5 h-5 text-base-content/60 mt-0.5" />
                <div class="text-base-content/80">
                  <LocationLink {location} />
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Event Participants -->
      {#if event.participants && event.participants.length > 0}
        <div class="mb-6">
          <h3 class="mb-3 text-lg font-semibold text-base-content">
            {event.participants.length > 1
              ? m.event_details_participants()
              : m.event_details_participant()}
          </h3>
          <div class="space-y-2">
            {#each event.participants as participant (participant.pubkey)}
              <div class="rounded-lg bg-base-200 p-3">
                <ProfileCard pubkey={participant.pubkey} showNpub={false} onClose={handleClose} />
                {#if participant.role}
                  <div class="mt-2 flex items-center gap-2">
                    <span class="badge badge-sm badge-primary">{participant.role}</span>
                  </div>
                {/if}
                {#if participant.relay}
                  <div class="mt-1 text-xs text-base-content/50">
                    {m.event_details_relay()}
                    {participant.relay}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Event Tags -->
      {#if event.hashtags && event.hashtags.length > 0}
        <div class="mb-6">
          <h3 class="mb-3 text-lg font-semibold text-base-content">{m.calendar_event_tags()}</h3>
          <div class="flex flex-wrap gap-2">
            {#each event.hashtags as tag (tag)}
              <a
                href={resolve(`/calendar?view=list&tags=${encodeURIComponent(tag)}`)}
                class="badge badge-outline badge-lg transition-colors hover:badge-primary"
                title={m.event_details_view_events_with_tag({ tag })}
              >
                #{tag}
              </a>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Further Links -->
      {#if event.references && event.references.length > 0}
        <div class="mb-6">
          <h3 class="mb-3 text-lg font-semibold text-base-content">
            {m.event_details_further_links()}
          </h3>
          <div class="space-y-2">
            {#each event.references as reference (reference)}
              <!-- eslint-disable svelte/no-navigation-without-resolve -- external: event reference URL -->
              <a
                href={reference}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 rounded-lg bg-base-200 p-3 transition hover:bg-base-300"
              >
                <ExternalLinkIcon class_="w-5 h-5 text-base-content/60" />
                <span class="break-all text-base-content/80">{reference}</span>
              </a>
              <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {/each}
          </div>
        </div>
      {/if}

      <!-- Reactions -->
      <div class="mb-6">
        <h3 class="mb-3 text-lg font-semibold text-base-content">{m.event_details_reactions()}</h3>
        <ReactionBar event={event?.originalEvent || event} />
      </div>

      <!-- Personal Calendar Sharing Section -->
      {#if manager.active}
        <div class="mb-4 border-t border-base-300 pt-4">
          <h3 class="mb-3 text-lg font-semibold text-base-content">
            {m.event_details_manage_calendar()}
          </h3>
          <PersonalCalendarShare {event} activeUser={manager.active} />
        </div>
      {/if}

      <!-- Community Sharing Section -->
      {#if manager.active}
        <div class="mb-4 border-t border-base-300 pt-4">
          <h3 class="mb-3 text-lg font-semibold text-base-content">
            {m.event_details_share_communities()}
          </h3>
          <CommunityShare event={event.originalEvent} activeUser={manager.active} />
        </div>
      {/if}

      <!-- Debug Information Component -->
      <EventDebugInfo {event} />

      <!-- Modal Actions -->
      <div class="flex justify-end gap-3 border-t border-base-300 pt-6">
        <button class="btn btn-outline" onclick={handleClose}>{m.event_details_close()}</button>
      </div>
    </div>
  </dialog>
{/if}
