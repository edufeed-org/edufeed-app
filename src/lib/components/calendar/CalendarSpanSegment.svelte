<!--
  CalendarSpanSegment — one continuous multi-day event bar in a week row of
  the month/week grid. Rendered in an overlay layer spanning the row's grid
  columns, so it floats above the cell borders instead of being sliced per
  day. Chevron caps mark spans clipped by the week boundary.
-->
<script>
  import { generateAuthorColor, readableTextColor } from '../../helpers/nostrUtils.js';

  /**
   * @typedef {import('../../helpers/calendar-lanes.js').WeekBar} WeekBar
   */

  /** @type {{ bar: WeekBar, onEventClick?: (event: any) => void }} */
  let { bar, onEventClick = () => {} } = $props();

  const event = $derived(bar.event);

  let inlineStyle = $derived.by(() => {
    if (event.color)
      return `background-color: ${event.color}; color: ${readableTextColor(event.color)}`;
    const color = generateAuthorColor(event.pubkey);
    return color
      ? `background-color: ${color}; color: ${readableTextColor(color)}`
      : 'color: #000000';
  });

  /** @param {Event} e */
  function handleClick(e) {
    e.stopPropagation();
    onEventClick(event);
  }

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  }
</script>

<div
  class="calendar-event-bar flex h-5 cursor-pointer items-center px-2 text-xs whitespace-nowrap shadow-sm transition-opacity hover:opacity-80
    {bar.clippedLeft ? 'rounded-l-none' : 'rounded-l'}
    {bar.clippedRight ? 'rounded-r-none' : 'rounded-r'}"
  style={inlineStyle}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
  title={event.title}
>
  {#if bar.clippedLeft}
    <span class="mr-1 shrink-0 opacity-60">‹</span>
  {/if}
  <span class="truncate font-medium">{event.title}</span>
  {#if bar.clippedRight}
    <span class="ml-auto shrink-0 pl-1 opacity-60">›</span>
  {/if}
</div>
