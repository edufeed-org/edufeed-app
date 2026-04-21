<!--
  CalendarEventBar Component
  Displays calendar events as compact horizontal bars (for month view)
-->

<script>
  import { formatCalendarDate } from '../../helpers/calendar.js';
  import { generateAuthorColor } from '../../helpers/nostrUtils.js';

  /**
   * @typedef {import('../../types/calendar.js').CalendarEvent} CalendarEvent
   */

  let { event, onEventClick = () => {} } = $props();

  // Format event times for display
  let startDate = $derived(new Date(event.start * 1000));
  let isAllDay = $derived(event.kind === 31922);

  // Generate color for this event's author
  // Use event color override if available
  let colorValues = $derived.by(() => {
    if (event.color) {
      // If custom color is provided, we'll use it as-is
      // Return null to signal we should use the override
      return null;
    }
    return generateAuthorColor(event.pubkey);
  });

  // Generate style string for background and text color
  // Text color is always black for better readability
  let inlineStyle = $derived.by(() => {
    if (event.color) {
      return `background-color: ${event.color}; color: #000000`;
    }
    const color = colorValues;
    if (!color) return 'color: #000000';
    return `background-color: ${color}; color: #000000`;
  });

  /**
   * @param {Event} e
   */
  function handleClick(e) {
    e.stopPropagation();
    onEventClick(event);
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

<div
  class="calendar-event-bar cursor-pointer truncate rounded px-2 py-0.5 text-xs transition-opacity hover:opacity-80"
  style={inlineStyle}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
  title={event.title}
>
  {#if !isAllDay}
    <span class="font-medium">{formatCalendarDate(startDate, 'time')}</span>
  {/if}
  <span class="ml-1">{event.title}</span>
</div>
