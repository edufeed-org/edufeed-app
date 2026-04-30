<script>
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();
</script>

<div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0">
  <div class="mx-auto max-w-4xl p-4">
    <CalendarEventDetailView event={data.event} rawEvent={data.rawEvent} />
  </div>
</div>
