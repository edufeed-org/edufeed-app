<!--
  PersonalCalendarShare Component
  Manages adding/removing calendar events to/from personal calendars.
  Uses shared calendar management store for DRY calendar loading and CRUD.
-->

<script>
  import { PlusIcon, CheckIcon, AlertIcon } from '../icons';
  import { useCalendarManagement } from '$lib/stores/calendar-management-store.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {any} event - Calendar event to share
   * @property {any} activeUser - Current active user
   * @property {boolean} [compact=false] - Use compact layout for dropdowns
   */

  /** @type {Props} */
  let { event, activeUser, compact = false } = $props();

  // Calendar management store — reuses singleton per pubkey
  let calendarManagement = $derived.by(() =>
    activeUser ? useCalendarManagement(activeUser.pubkey) : null
  );
  let calendars = $derived(calendarManagement?.calendars ?? []);
  let loading = $derived(calendarManagement?.loading ?? false);

  // State management
  let selectedCalendarIds = $state(/** @type {string[]} */ ([]));
  let isProcessingChanges = $state(false);
  let calendarChangesError = $state('');
  let calendarChangesSuccess = $state(false);

  /**
   * Generate event reference for NIP-52 (addressable format)
   * Handles missing dTag by extracting from originalEvent or generating one
   * @param {any} evt
   * @returns {string | null}
   */
  function getEventReference(evt) {
    if (!evt || !evt.kind || !evt.pubkey) {
      return null;
    }

    // Try to get dTag from event
    let dTag = evt.dTag;

    // If no dTag, try to extract from originalEvent tags
    if (!dTag && evt.originalEvent?.tags) {
      const dTagArray = evt.originalEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'd');
      dTag = dTagArray?.[1];
    }

    // If still no dTag, generate one from event ID
    if (!dTag && evt.id) {
      dTag = `event-${evt.id.slice(0, 8)}`;
    }

    if (!dTag) {
      return null;
    }

    return `${evt.kind}:${evt.pubkey}:${dTag}`;
  }

  /**
   * Check which calendars already contain this event
   * Returns a Set of calendar IDs
   */
  let calendarsContainingEvent = $derived.by(() => {
    if (!calendars.length || !event) return new Set();

    const eventRef = getEventReference(event);
    if (!eventRef) return new Set();

    const containingCalendars = calendars
      .filter((calendar) => calendar.eventReferences.includes(eventRef))
      .map((calendar) => calendar.id);

    return new Set(containingCalendars);
  });

  /**
   * Toggle calendar selection
   * @param {string} calendarId
   */
  function toggleCalendarSelection(calendarId) {
    if (selectedCalendarIds.includes(calendarId)) {
      selectedCalendarIds = selectedCalendarIds.filter((id) => id !== calendarId);
    } else {
      selectedCalendarIds = [...selectedCalendarIds, calendarId];
    }
  }

  /**
   * Select all calendars that don't already contain the event
   */
  function selectAllCalendars() {
    const availableCalendars = calendars
      .filter((calendar) => !calendarsContainingEvent.has(calendar.id))
      .map((calendar) => calendar.id);
    selectedCalendarIds = availableCalendars;
  }

  /**
   * Deselect all calendars
   */
  function deselectAllCalendars() {
    selectedCalendarIds = [];
  }

  /**
   * Handle applying calendar changes (add/remove events)
   */
  async function handleApplyCalendarChanges() {
    if (selectedCalendarIds.length === 0 || !activeUser || !event || !calendarManagement) {
      return;
    }

    isProcessingChanges = true;
    calendarChangesError = '';
    calendarChangesSuccess = false;

    try {
      // Build event object with originalEvent for ActionRunner
      // The ActionRunner needs the full NostrEvent (kind 31922/31923)
      const calendarEvent = event.originalEvent || event;

      // Process each selected calendar
      const results = await Promise.allSettled(
        selectedCalendarIds.map(async (calendarId) => {
          const isAlreadyInCalendar = calendarsContainingEvent.has(calendarId);

          if (isAlreadyInCalendar) {
            return await calendarManagement.removeEventFromCalendar(calendarId, calendarEvent);
          } else {
            return await calendarManagement.addEventToCalendar(calendarId, calendarEvent);
          }
        })
      );

      // Check results
      const successful = results.filter(
        (result) => result.status === 'fulfilled' && result.value === true
      ).length;

      if (successful > 0) {
        calendarChangesSuccess = true;
        selectedCalendarIds = [];
      } else {
        calendarChangesError = 'Failed to apply changes to any calendar';
      }
    } catch (err) {
      console.error('PersonalCalendarShare: Error applying changes:', err);
      calendarChangesError =
        err instanceof Error ? err.message : 'Failed to apply calendar changes';
    } finally {
      isProcessingChanges = false;
    }
  }
</script>

<!-- Calendar Selection UI -->
<div class="personal-calendar-share" class:compact>
  <div class="mb-3">
    <div class="mb-2 flex items-center justify-between">
      <div class="block text-sm font-medium text-base-content">
        {compact ? m.personal_calendar_title() : m.personal_calendar_select_title()}
      </div>
      {#if calendars.length > 1}
        <div class="flex gap-2">
          <button
            class="btn btn-ghost btn-xs"
            onclick={selectAllCalendars}
            disabled={selectedCalendarIds.length === calendars.length}
          >
            {m.personal_calendar_select_all()}
          </button>
          <button
            class="btn btn-ghost btn-xs"
            onclick={deselectAllCalendars}
            disabled={selectedCalendarIds.length === 0}
          >
            {m.personal_calendar_deselect_all()}
          </button>
        </div>
      {/if}
    </div>

    <!-- Calendar Checkboxes -->
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-spinner {compact ? 'loading-sm' : 'loading-md'}"></span>
      </div>
    {:else if calendars.length > 0}
      <div class="max-h-40 overflow-y-auto rounded-lg border border-base-300 p-3">
        {#each calendars as calendar (calendar.id)}
          {@const isAlreadyInCalendar = calendarsContainingEvent.has(calendar.id)}
          {@const isSelected = selectedCalendarIds.includes(calendar.id)}
          <label class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-200">
            <input
              type="checkbox"
              class="checkbox checkbox-primary {compact ? 'checkbox-sm' : ''}"
              checked={isSelected || isAlreadyInCalendar}
              onchange={() => toggleCalendarSelection(calendar.id)}
            />
            <span class="font-medium {compact ? 'text-sm' : ''}">{calendar.title}</span>
            {#if calendar.description && !compact}
              <span class="truncate text-xs text-base-content/60">{calendar.description}</span>
            {/if}
            {#if isAlreadyInCalendar && !isSelected}
              <span class="text-xs font-medium text-success"
                >{m.personal_calendar_added_click_remove()}</span
              >
            {:else if isAlreadyInCalendar && isSelected}
              <span class="text-xs font-medium text-warning"
                >{m.personal_calendar_will_be_removed()}</span
              >
            {:else if isSelected}
              <span class="text-xs font-medium text-info"
                >{m.personal_calendar_will_be_added()}</span
              >
            {/if}
          </label>
        {/each}
      </div>

      <!-- Selected Calendars Summary -->
      {#if selectedCalendarIds.length > 0}
        <div class="mt-2 text-sm text-base-content/70">
          {m.personal_calendar_count_selected({ count: selectedCalendarIds.length })}
        </div>
      {/if}
    {:else}
      <div class="py-4 text-center text-base-content/60 {compact ? 'text-sm' : ''}">
        {m.personal_calendar_no_calendars()}
      </div>
      <button
        class="btn btn-outline btn-primary {compact ? 'btn-block btn-sm' : ''}"
        onclick={() => modalStore.openModal('createCalendar')}
      >
        <PlusIcon class_="w-4 h-4 mr-2" />
        {m.calendar_dropdown_create_new()}
      </button>
    {/if}
  </div>

  <!-- Apply Changes Button -->
  {#if loading || calendars.length > 0}
    <div class="flex items-center gap-3">
      <button
        class="btn btn-primary {compact ? 'btn-block btn-sm' : ''}"
        disabled={selectedCalendarIds.length === 0 || isProcessingChanges}
        onclick={handleApplyCalendarChanges}
      >
        {#if isProcessingChanges}
          <span class="loading loading-spinner {compact ? 'loading-sm' : ''}"></span>
          {m.personal_calendar_applying({ count: selectedCalendarIds.length })}
        {:else}
          <PlusIcon class_="w-4 h-4 mr-2" />
          {m.personal_calendar_apply_changes({ count: selectedCalendarIds.length })}
        {/if}
      </button>
    </div>
  {/if}

  <!-- Success Message -->
  {#if calendarChangesSuccess}
    <div class="mt-3 alert alert-success {compact ? 'py-2' : ''}">
      <CheckIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{m.personal_calendar_success()}</span>
    </div>
  {/if}

  <!-- Error Message -->
  {#if calendarChangesError}
    <div class="mt-3 alert alert-error {compact ? 'py-2' : ''}">
      <AlertIcon class_={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      <span class={compact ? 'text-sm' : ''}>{calendarChangesError}</span>
    </div>
  {/if}
</div>
