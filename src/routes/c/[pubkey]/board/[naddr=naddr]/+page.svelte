<script>
  import KanbanBoardView from '$lib/components/kanban/KanbanBoardView.svelte';
  import EventLoadingState from '$lib/components/shared/EventLoadingState.svelte';
  import { useReplaceableEvent } from '$lib/stores/replaceable-event.svelte.js';

  /** @type {{ data: any }} */
  let { data } = $props();

  const getState = useReplaceableEvent(() => data.pointer);
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  <EventLoadingState state={getState()}>
    {#snippet content(event)}
      <KanbanBoardView {event} />
    {/snippet}
  </EventLoadingState>
</div>
