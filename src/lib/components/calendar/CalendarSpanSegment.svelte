<!--
  CalendarSpanSegment — one day-cell piece of a multi-day event bar in the
  month/week grid. Pieces of the same event share a lane across the week;
  middle pieces drop their rounding and bleed over the cell padding + grid
  gap so the bar reads as one continuous span. Week-boundary continuations
  get chevron caps.
-->
<script>
  import { generateAuthorColor } from '../../helpers/nostrUtils.js';

  /**
   * @typedef {import('../../helpers/calendar-lanes.js').LaneSegment} LaneSegment
   */

  /** @type {{ segment: LaneSegment, onEventClick?: (event: any) => void }} */
  let { segment, onEventClick = () => {} } = $props();

  const event = $derived(segment.event);

  let inlineStyle = $derived.by(() => {
    if (event.color) return `background-color: ${event.color}; color: #000000`;
    const color = generateAuthorColor(event.pubkey);
    return color ? `background-color: ${color}; color: #000000` : 'color: #000000';
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
  class="calendar-event-bar flex h-5 cursor-pointer items-center overflow-hidden text-xs whitespace-nowrap transition-opacity hover:opacity-80
    {segment.continuesLeft ? 'seg-bleed-l' : 'ml-0 rounded-l pl-2'}
    {segment.continuesRight ? 'seg-bleed-r' : 'mr-0 rounded-r pr-2'}"
  style={inlineStyle}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
  title={event.title}
>
  {#if segment.clippedLeft}
    <span class="mr-0.5 shrink-0 opacity-60">‹</span>
  {/if}
  {#if segment.showTitle}
    <span class="truncate font-medium">{event.title}</span>
  {:else}
    <!-- middle/continuation piece: keep the bar height, no repeated title -->
    <span class="sr-only">{event.title}</span>
  {/if}
  {#if segment.clippedRight}
    <span class="ml-auto shrink-0 pl-0.5 opacity-60">›</span>
  {/if}
</div>

<style>
  /* Bleed over the cell's p-2 padding (8px) plus the 1px grid gap so
     neighbouring pieces visually connect into one bar. */
  .seg-bleed-l {
    margin-left: -9px;
    padding-left: 2px;
  }
  .seg-bleed-r {
    margin-right: -9px;
    padding-right: 2px;
  }
</style>
