<script>
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import CalendarEventDetailView from '$lib/components/calendar/CalendarEventDetailView.svelte';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.event?.title || 'Event'} - {runtimeConfig.appName}</title>
  <meta name="description" content="View calendar event details" />
</svelte:head>

<div class="container mx-auto max-w-4xl px-4 py-8">
  <CalendarEventDetailView event={data.event} rawEvent={data.rawEvent} />
</div>
