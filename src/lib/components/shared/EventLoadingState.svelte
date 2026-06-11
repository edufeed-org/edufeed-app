<!--
  EventLoadingState — Renders one of three states from a useReplaceableEvent
  (or similar) hook: a loading spinner, a "not found" message, or the
  `content` snippet with the loaded event.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   state: { event: any, loading: boolean, notFound: boolean },
   *   content: import('svelte').Snippet<[any]>
   * }}
   */
  let { state, content } = $props();
</script>

{#if state.event}
  {@render content(state.event)}
{:else if state.notFound}
  <div class="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
    <p class="text-lg font-medium text-base-content/80">{m.error_not_found()}</p>
  </div>
{:else if state.loading}
  <div class="flex min-h-[40vh] flex-col items-center justify-center gap-3">
    <span class="loading loading-lg loading-spinner text-primary" aria-hidden="true"></span>
    <p class="text-sm text-base-content/60">{m.common_loading()}</p>
  </div>
{/if}
