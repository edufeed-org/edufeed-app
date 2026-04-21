<!--
  CalendarSelector Component
  Reusable component for selecting calendars to add events to
-->

<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Calendar
   * @property {string} id - Calendar ID
   * @property {string} title - Calendar title
   * @property {string} [description] - Calendar description
   * @property {string[]} eventReferences - Array of event references
   */

  let {
    calendars = [],
    selectedCalendarIds = $bindable([]),
    event = null,
    title = 'Select Calendars',
    showSelectAll = true
  } = $props();

  // Get calendars that already contain this event
  let calendarsContainingEvent = $derived.by(() => {
    if (!event || !event.kind || !event.pubkey || !event.dTag) {
      return new Set();
    }
    const eventRef = `${event.kind}:${event.pubkey}:${event.dTag}`;
    return new Set(
      calendars
        .filter((calendar) => calendar.eventReferences.includes(eventRef))
        .map((calendar) => calendar.id)
    );
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
</script>

<div class="mb-3">
  <div class="mb-2 flex items-center justify-between">
    <div class="block text-sm font-medium text-base-content">
      {title}
    </div>
    {#if showSelectAll && calendars.length > 1}
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={selectAllCalendars}
          disabled={selectedCalendarIds.length === calendars.length}
        >
          {m.calendar_selector_select_all()}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={deselectAllCalendars}
          disabled={selectedCalendarIds.length === 0}
        >
          {m.calendar_selector_deselect_all()}
        </button>
      </div>
    {/if}
  </div>

  <!-- Calendar Checkboxes -->
  <div class="max-h-40 overflow-y-auto rounded-lg border border-base-300 p-3">
    {#each calendars as calendar (calendar.id)}
      {@const isAlreadyInCalendar = event ? calendarsContainingEvent.has(calendar.id) : false}
      {@const isSelected = selectedCalendarIds.includes(calendar.id)}
      <label class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-200">
        <input
          type="checkbox"
          class="checkbox checkbox-primary"
          checked={isSelected || isAlreadyInCalendar}
          onchange={() => toggleCalendarSelection(calendar.id)}
        />
        <div class="flex-1">
          <span class="text-sm font-medium">{calendar.title}</span>
          {#if calendar.description}
            <span class="ml-2 truncate text-xs text-base-content/60">{calendar.description}</span>
          {/if}
        </div>
        {#if isAlreadyInCalendar && !isSelected}
          <span class="text-xs font-medium text-success">{m.calendar_selector_added()}</span>
        {:else if isAlreadyInCalendar && isSelected}
          <span class="text-xs font-medium text-warning">{m.calendar_selector_will_remove()}</span>
        {:else if isSelected}
          <span class="text-xs font-medium text-info">{m.calendar_selector_will_add()}</span>
        {/if}
      </label>
    {/each}
    {#if calendars.length === 0}
      <div class="py-4 text-center text-base-content/60">{m.calendar_selector_no_calendars()}</div>
    {/if}
  </div>

  <!-- Selected Calendars Summary -->
  {#if selectedCalendarIds.length > 0}
    <div class="mt-2 text-sm text-base-content/70">
      {m.calendar_selector_count({ count: String(selectedCalendarIds.length) })}
    </div>
  {/if}
</div>
