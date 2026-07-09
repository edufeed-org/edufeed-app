<script>
  import {
    getWeekDates,
    getMonthDates,
    formatCalendarDate,
    isToday,
    isCurrentMonth,
    getWeekdayHeaders,
    createDateKey,
    groupEventsByDate
  } from '../../helpers/calendar.js';
  import CalendarEventCard from './CalendarEventCard.svelte';
  import CalendarEventBar from './CalendarEventBar.svelte';
  import CalendarSpanSegment from './CalendarSpanSegment.svelte';
  import { layoutWeekLanes, isMultiDayEvent } from '../../helpers/calendar-lanes.js';

  /**
   * @typedef {import('../../types/calendar.js').CalendarEvent} CalendarEvent
   * @typedef {import('../../types/calendar.js').CalendarViewMode} CalendarViewMode
   */

  let { currentDate, viewMode, events, onEventClick = () => {}, onDateClick = () => {} } = $props();

  // Get dates for current view (reactive to prop changes)
  let viewDates = $derived(getViewDates(currentDate, viewMode));
  let weekdays = $derived(getWeekdayHeaders());

  let groupedEvents = $derived.by(() => {
    const grouped = groupEventsByDate(events);
    return grouped;
  });

  // Week rows for month/week views (7 dates each) — multi-day events render
  // as continuous lane bars per week, single-day events stay in their cell.
  let weeks = $derived.by(() => {
    if (viewMode === 'day') return [];
    const chunks = [];
    for (let i = 0; i < viewDates.length; i += 7) chunks.push(viewDates.slice(i, i + 7));
    return chunks;
  });

  let multiDayEvents = $derived.by(() => {
    const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local dedup
    return (events || []).filter((/** @type {any} */ e) => {
      if (!e?.id || seen.has(e.id) || !isMultiDayEvent(e)) return false;
      seen.add(e.id);
      return true;
    });
  });

  /** @param {Date[]} weekDates */
  function weekLayout(weekDates) {
    return layoutWeekLanes(weekDates.map(createDateKey), multiDayEvents);
  }

  /** @param {Date} date */
  function singleDayEventsFor(date) {
    return getEventsForDate(date).filter((e) => !isMultiDayEvent(e));
  }

  /**
   * Get dates array for current view mode
   * @param {Date} date
   * @param {CalendarViewMode} mode
   * @returns {Date[]}
   */
  function getViewDates(date, mode) {
    switch (mode) {
      case 'month':
        return getMonthDates(date);
      case 'week':
        return getWeekDates(date);
      case 'day':
        return [new Date(date)];
      default:
        return getMonthDates(date);
    }
  }

  /**
   * Get events for a specific date
   * @param {Date} date
   * @returns {CalendarEvent[]}
   */
  function getEventsForDate(date) {
    // Use UTC-based date key to match how events are grouped
    // This ensures consistent date key generation between calendar grid and event grouping
    const dateKey = createDateKey(date); // UTC-based YYYY-MM-DD format

    const eventsMap = groupedEvents;
    const eventsForDate = eventsMap.get(dateKey) || [];

    return eventsForDate;
  }

  /**
   * @param {MouseEvent | KeyboardEvent} e
   * @param {Date} date
   */
  function handleDateClick(e, date) {
    // Prevent date navigation if clicking on an event
    const target = /** @type {Element} */ (e.target);
    if (
      target &&
      (target.closest('.calendar-event-card') || target.closest('.calendar-event-bar'))
    ) {
      return;
    }
    onDateClick(date);
  }

  /**
   * @param {CalendarEvent} event
   */
  function handleEventClick(event) {
    onEventClick(event);
  }

  /**
   * @param {KeyboardEvent} e
   * @param {Date} date
   */
  function handleDateKeydown(e, date) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDateClick(e, date);
    }
  }
</script>

<div class="overflow-hidden rounded-lg border border-base-300 bg-base-100">
  <!-- Weekday Headers (for month and week views) -->
  {#if viewMode !== 'day'}
    <div class="grid grid-cols-7 border-b border-base-300 bg-base-200">
      {#each weekdays as weekday (weekday)}
        <div
          class="border-r border-base-300 p-3 text-center text-sm font-medium text-base-content last:border-r-0"
        >
          {weekday}
        </div>
      {/each}
    </div>
  {/if}
  <!-- Calendar Grid -->
  {#if viewMode === 'day'}
    <div class="grid grid-cols-1 gap-px bg-base-300">
      {#each viewDates as date (date.toISOString())}
        {@const dayEvents = getEventsForDate(date)}
        {@const isCurrentDay = isToday(date)}
        <div
          class="flex h-full cursor-pointer flex-col p-4 transition-colors duration-200 hover:bg-base-200 focus:ring-2 focus:ring-primary focus:outline-none focus:ring-inset {isCurrentDay
            ? 'ring-2 ring-primary ring-inset'
            : ''}"
          role="button"
          tabindex="0"
          onclick={(e) => handleDateClick(e, date)}
          onkeydown={(e) => handleDateKeydown(e, date)}
        >
          <!-- Date Number -->
          <div class="mb-1 flex-shrink-0 text-sm font-medium {isCurrentDay ? 'text-primary' : ''}">
            <div class="mb-4 text-center">
              <div class="text-lg font-semibold text-base-content">
                {formatCalendarDate(date, 'long')}
              </div>
              <div class="text-3xl font-bold text-primary">{date.getDate()}</div>
            </div>
          </div>

          <!-- Events for this date -->
          <div class="flex-1 space-y-2 overflow-x-hidden overflow-y-auto">
            {#each dayEvents as event (event.id)}
              <CalendarEventCard {event} compact={false} onEventClick={handleEventClick} />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <!-- Month/Week: one grid per week row so multi-day events can span as
         continuous bars across the row (Google-Calendar style). The bars
         live in an absolutely positioned overlay grid ABOVE the cells, so
         they float over the cell borders instead of being sliced per day;
         cells reserve matching vertical space below their date number. -->
    <div class="flex flex-col gap-px bg-base-300">
      {#each weeks as week (week[0].toISOString())}
        {@const layout = weekLayout(week)}
        {@const todayCol = week.findIndex((d) => isToday(d)) + 1}
        <div class="relative">
          <!-- Today indicator as the TOPMOST layer, so the multi-day bar
               overlay cannot paint over the highlight ring. -->
          {#if todayCol > 0}
            <div class="pointer-events-none absolute inset-0 z-20 grid grid-cols-7 gap-px">
              <div
                class="ring-2 ring-primary ring-inset"
                style="grid-column: {todayCol}"
                aria-hidden="true"
              ></div>
            </div>
          {/if}
          {#if layout.laneCount > 0}
            <!-- top-8 = cell padding (8px) + date-number row (h-5 + mb-1) -->
            <div
              class="pointer-events-none absolute inset-x-0 top-8 z-10 grid grid-cols-7"
              style="grid-auto-rows: 22px; column-gap: 1px;"
            >
              {#each layout.bars as bar (bar.event.id)}
                <div
                  class="pointer-events-auto pr-1"
                  style="grid-column: {bar.colStart} / span {bar.span}; grid-row: {bar.lane + 1};"
                >
                  <CalendarSpanSegment {bar} onEventClick={handleEventClick} />
                </div>
              {/each}
            </div>
          {/if}

          <div class="grid grid-cols-7 gap-px">
            {#each week as date (date.toISOString())}
              {@const singleDayEvents = singleDayEventsFor(date)}
              {@const isCurrentDay = isToday(date)}
              {@const isInCurrentMonth = viewMode !== 'month' || isCurrentMonth(date, currentDate)}

              {@const cellClasses = [
                'p-2 hover:bg-base-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset cursor-pointer transition-colors duration-200 flex flex-col overflow-hidden bg-base-100',
                viewMode === 'week' ? 'min-h-96' : 'min-h-24',
                !isInCurrentMonth ? 'bg-base-200 text-base-content/40' : ''
              ]
                .filter(Boolean)
                .join(' ')}

              <div
                class={cellClasses}
                role="button"
                tabindex="0"
                onclick={(e) => handleDateClick(e, date)}
                onkeydown={(e) => handleDateKeydown(e, date)}
              >
                <!-- Date Number (h-5 keeps the overlay's top offset stable) -->
                <div
                  class="mb-1 h-5 flex-shrink-0 text-sm font-medium {isCurrentDay
                    ? 'text-primary'
                    : ''}"
                >
                  {date.getDate()}
                </div>

                <!-- Reserved space matching the overlay's lane rows -->
                {#if layout.laneCount > 0}
                  <div
                    class="mb-1 flex-shrink-0"
                    style="height: {layout.laneCount * 22 - 2}px"
                    aria-hidden="true"
                  ></div>
                {/if}

                <!-- Single-day events for this date -->
                <div class="flex-1 space-y-1 overflow-x-hidden overflow-y-auto">
                  {#each singleDayEvents as event (event.id)}
                    <CalendarEventBar {event} onEventClick={handleEventClick} />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
