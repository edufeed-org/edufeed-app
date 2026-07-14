<!--
  EventDateRangeFilter Component
  Date range filter for calendar events with prev/next navigation and custom date picker
-->

<script>
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/icons';
  import { CalendarIcon } from '$lib/components/icons';
  import EuropeanDateInput from '$lib/components/shared/EuropeanDateInput.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} DateRange
   * @property {number} start - Unix timestamp (seconds)
   * @property {number} end - Unix timestamp (seconds)
   */

  /** @type {{ start: number, end: number, onrangechange: (range: DateRange) => void, disabled?: boolean }} */
  let { start, end, onrangechange, disabled = false } = $props();

  // Range step: 3 months in seconds
  const RANGE_MONTHS = 3;
  const RANGE_SECONDS = RANGE_MONTHS * 30 * 24 * 60 * 60;

  // Date picker state
  let showDatePicker = $state(false);
  let pickerStartDate = $state('');
  let pickerEndDate = $state('');

  // Format date range for display (e.g., "Feb 2026 - May 2026")
  const displayRange = $derived.by(() => {
    const startDate = new Date(start * 1000);
    const endDate = new Date(end * 1000);

    const startStr = startDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const endStr = endDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

    return `${startStr} - ${endStr}`;
  });

  // Check if current range is "today" (within tolerance)
  const isAtToday = $derived.by(() => {
    const now = Math.floor(Date.now() / 1000);
    // Consider "at today" if start is within 1 day of now
    return Math.abs(start - now) < 24 * 60 * 60;
  });

  function handlePrev() {
    if (disabled) return;
    onrangechange({
      start: start - RANGE_SECONDS,
      end: end - RANGE_SECONDS
    });
  }

  function handleNext() {
    if (disabled) return;
    onrangechange({
      start: start + RANGE_SECONDS,
      end: end + RANGE_SECONDS
    });
  }

  function handleToday() {
    if (disabled) return;
    const now = Math.floor(Date.now() / 1000);
    onrangechange({
      start: now,
      end: now + RANGE_SECONDS
    });
  }

  function openDatePicker() {
    if (disabled) return;
    // Initialize picker with current range
    pickerStartDate = new Date(start * 1000).toISOString().split('T')[0];
    pickerEndDate = new Date(end * 1000).toISOString().split('T')[0];
    showDatePicker = true;
  }

  function closeDatePicker() {
    showDatePicker = false;
  }

  function applyDatePicker() {
    if (!pickerStartDate || !pickerEndDate) return;

    const newStart = Math.floor(new Date(pickerStartDate).getTime() / 1000);
    const newEnd = Math.floor(new Date(pickerEndDate).getTime() / 1000) + 24 * 60 * 60; // End of day

    if (newStart >= newEnd) {
      // Invalid range, swap them
      onrangechange({ start: newEnd - 24 * 60 * 60, end: newStart + 24 * 60 * 60 });
    } else {
      onrangechange({ start: newStart, end: newEnd });
    }

    closeDatePicker();
  }

  function handleKeydown(/** @type {KeyboardEvent} */ e) {
    if (e.key === 'Escape') {
      closeDatePicker();
    }
  }
</script>

<div class="flex items-center gap-2" data-testid="date-range-filter">
  <!-- Prev button -->
  <button
    type="button"
    class="btn btn-circle btn-ghost btn-sm"
    onclick={handlePrev}
    {disabled}
    aria-label={m.discover_events_date_range_prev()}
    title={m.discover_events_date_range_prev()}
    data-testid="date-range-prev"
  >
    <ChevronLeftIcon class_="w-5 h-5" />
  </button>

  <!-- Date range display / Custom picker trigger -->
  <button
    type="button"
    class="btn gap-2 font-medium btn-ghost btn-sm"
    onclick={openDatePicker}
    {disabled}
    aria-label={m.discover_events_date_range_custom()}
    title={m.discover_events_date_range_custom()}
    data-testid="date-range-display"
  >
    <CalendarIcon class_="w-4 h-4" />
    <span class="whitespace-nowrap">{displayRange}</span>
  </button>

  <!-- Next button -->
  <button
    type="button"
    class="btn btn-circle btn-ghost btn-sm"
    onclick={handleNext}
    {disabled}
    aria-label={m.discover_events_date_range_next()}
    title={m.discover_events_date_range_next()}
    data-testid="date-range-next"
  >
    <ChevronRightIcon class_="w-5 h-5" />
  </button>

  <!-- Today button (only show if not already at today) -->
  {#if !isAtToday}
    <button
      type="button"
      class="btn btn-outline btn-sm"
      onclick={handleToday}
      {disabled}
      data-testid="date-range-today"
    >
      {m.discover_events_date_range_today()}
    </button>
  {/if}
</div>

<!-- Date Picker Modal -->
{#if showDatePicker}
  <dialog class="modal-open modal" onkeydown={handleKeydown} data-testid="date-range-modal">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={closeDatePicker}></div>
    <div class="modal-box max-w-sm">
      <h3 class="mb-4 text-lg font-bold">{m.discover_events_date_range_custom()}</h3>

      <div class="space-y-4">
        <!-- From date -->
        <div class="form-control">
          <label class="label" for="date-range-start">
            <span class="label-text">{m.discover_events_date_range_from()}</span>
          </label>
          <EuropeanDateInput
            id="date-range-start"
            bind:value={pickerStartDate}
            data-testid="date-range-start-input"
          />
        </div>

        <!-- To date -->
        <div class="form-control">
          <label class="label" for="date-range-end">
            <span class="label-text">{m.discover_events_date_range_to()}</span>
          </label>
          <EuropeanDateInput
            id="date-range-end"
            bind:value={pickerEndDate}
            data-testid="date-range-end-input"
          />
        </div>
      </div>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost"
          onclick={closeDatePicker}
          data-testid="date-range-cancel"
        >
          {m.discover_events_date_range_cancel()}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={applyDatePicker}
          disabled={!pickerStartDate || !pickerEndDate}
          data-testid="date-range-apply"
        >
          {m.discover_events_date_range_apply()}
        </button>
      </div>
    </div>
  </dialog>
{/if}
