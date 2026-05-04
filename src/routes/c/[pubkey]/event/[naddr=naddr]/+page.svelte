<script>
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  <CalendarEventDetailView event={data.event} rawEvent={data.rawEvent} />
</div>
