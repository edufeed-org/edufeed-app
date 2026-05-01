<script>
  import KanbanBoardView from '$lib/components/kanban/KanbanBoardView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();
</script>

<div class="mx-auto max-w-4xl p-4 lg:ml-(--sidebar-nav-w)">
  {#if data.event}
    <KanbanBoardView event={data.event} />
  {/if}
</div>
