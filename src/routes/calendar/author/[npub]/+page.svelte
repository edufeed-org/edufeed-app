<script>
  import * as m from '$lib/paraglide/messages';
  import CalendarView from '$lib/components/calendar/CalendarView.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';

  /** @type {import('./$types').PageProps} */
  let { data } = $props();
</script>

<svelte:head>
  <title>My Events - {runtimeConfig.appName}</title>
  <meta name="description" content="View your calendar events" />
</svelte:head>

<div class="container mx-auto px-4 py-8">
  {#if data.pubkey}
    <CalendarView authorPubkey={data.pubkey} globalMode={false} />
  {:else}
    <div class="alert alert-error">
      <span>{m.route_invalid_user_id()}</span>
    </div>
  {/if}
</div>
