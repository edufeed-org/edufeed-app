<script>
  import AMBResourceView from '$lib/components/educational/AMBResourceView.svelte';
  import EventLoadingState from '$lib/components/shared/EventLoadingState.svelte';
  import { useReplaceableEvent } from '$lib/stores/replaceable-event.svelte.js';
  import { formatAMBResource } from '$lib/helpers/educational';

  /** @type {{ data: any }} */
  let { data } = $props();

  const getState = useReplaceableEvent(() => data.pointer);
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  <EventLoadingState state={getState()}>
    {#snippet content(event)}
      <AMBResourceView {event} resource={formatAMBResource(event)} />
    {/snippet}
  </EventLoadingState>
</div>
