<script>
  import KanbanBoardView from '$lib/components/kanban/KanbanBoardView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();
</script>

<div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0">
  <div class="mx-auto max-w-4xl p-4">
    {#if data.event}
      <KanbanBoardView event={data.event} />
    {/if}
  </div>
</div>
