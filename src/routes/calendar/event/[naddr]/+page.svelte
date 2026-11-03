<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';
  import { useLatestReplaceableEvent } from '$lib/stores/latest-replaceable-event.svelte.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
  import * as m from '$lib/paraglide/messages';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();

  // The load's snapshot is the first paint; newer revisions and the author's
  // NIP-09 deletions replace it live.
  const getLatest = useLatestReplaceableEvent(
    () => data.pointer,
    () => data.rawEvent
  );
  const rawEvent = $derived(getLatest().event);
  const event = $derived(rawEvent ? getCalendarEventMetadata(rawEvent) : null);
</script>

<svelte:head>
  <title>{event?.title || 'Event'} - {runtimeConfig.appName}</title>
  <meta name="description" content="View calendar event details" />
</svelte:head>

<div class="container mx-auto max-w-4xl px-4 py-8">
  {#if getLatest().deleted}
    <div class="alert alert-warning" data-testid="calendar-event-deleted">
      <span>{m.calendar_detail_deleted()}</span>
    </div>
  {:else}
    <CalendarEventDetailView {event} {rawEvent} />
  {/if}
</div>
