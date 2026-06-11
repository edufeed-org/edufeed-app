<script>
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';
  import EventLoadingState from '$lib/components/shared/EventLoadingState.svelte';
  import { useReplaceableEvent } from '$lib/stores/replaceable-event.svelte.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';

  /** @type {{ data: any }} */
  let { data } = $props();

  const getState = useReplaceableEvent(() => data.pointer);
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  <EventLoadingState state={getState()}>
    {#snippet content(rawEvent)}
      <CalendarEventDetailView event={getCalendarEventMetadata(rawEvent)} {rawEvent} />
    {/snippet}
  </EventLoadingState>
</div>
