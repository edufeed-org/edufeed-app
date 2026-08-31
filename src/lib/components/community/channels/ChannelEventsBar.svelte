<!--
  ChannelEventsBar — NIP-52 events posted into a Concord channel, surfaced
  above the chat (Armada: "not timeline messages — surfaced in the events
  bar"). Upcoming events only, soonest first; RSVP is one click and shows
  the live per-status counts (latest RSVP per member wins).
-->
<script>
  import { startEpoch, isUpcoming, tallyRsvps } from '$lib/concord/channel-events.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{events: import('$lib/concord/channel-events.js').ChannelCalendarEvent[],
   *         rsvpsByEvent: Map<string, any[]>,
   *         myPubkey: string | undefined,
   *         readOnly?: boolean,
   *         onRsvp: (eventId: string, status: import('$lib/concord/channel-events.js').RsvpStatus) => void}}
   */
  let { events, rsvpsByEvent, myPubkey, readOnly = false, onRsvp } = $props();

  const upcoming = $derived(events.filter((event) => isUpcoming(event)));
  let open = $state(false);

  /** @type {Array<[import('$lib/concord/channel-events.js').RsvpStatus, string]>} */
  const STATUSES = [
    ['accepted', '✓'],
    ['tentative', '?'],
    ['declined', '✗']
  ];

  /** @param {import('$lib/concord/channel-events.js').ChannelCalendarEvent} event */
  function formatStart(event) {
    const epoch = startEpoch(event);
    if (!epoch) return event.start;
    const date = new Date(epoch * 1000);
    return event.dateBased
      ? date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
      : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

{#if upcoming.length > 0}
  <div class="border-b border-base-300 bg-base-200/50">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold"
      data-testid="events-bar-toggle"
      onclick={() => (open = !open)}
    >
      📅 {m.concord_events_title({ count: upcoming.length })}
      <span class="ml-auto text-xs opacity-60">{open ? '▲' : '▼'}</span>
    </button>
    {#if open}
      <ul class="flex flex-col gap-2 px-4 pb-3">
        {#each upcoming as event (event.id)}
          {@const tally = tallyRsvps(rsvpsByEvent.get(event.id) ?? [], myPubkey)}
          <li
            class="rounded border border-base-300 bg-base-100 p-2 text-sm"
            data-testid="event-row"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold">{event.title}</span>
              <time class="text-xs opacity-60">{formatStart(event)}</time>
            </div>
            {#if event.location}
              <div class="text-xs opacity-60">📍 {event.location}</div>
            {/if}
            <div class="mt-1 flex items-center gap-1">
              {#each STATUSES as [status, glyph] (status)}
                <button
                  type="button"
                  class="btn btn-xs {tally.mine === status ? 'btn-primary' : 'btn-ghost'}"
                  data-testid="rsvp-{status}"
                  disabled={readOnly}
                  title={status}
                  onclick={() => onRsvp(event.id, status)}
                >
                  {glyph}
                  {tally[status].length}
                </button>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
