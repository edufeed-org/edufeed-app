<script>
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();
</script>

<div class="mx-auto max-w-4xl p-4 lg:ml-(--sidebar-nav-w)">
  <CalendarEventDetailView event={data.event} rawEvent={data.rawEvent} />
</div>
