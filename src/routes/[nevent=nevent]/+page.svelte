<script>
  import * as m from '$lib/paraglide/messages';
  import ThreadDetailView from '$lib/components/thread/ThreadDetailView.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getTagValue } from 'applesauce-core/helpers';

  /** @type {{ data: any }} */
  let { data } = $props();

  const pageTitle = $derived.by(() => {
    if (!data.event) return `Event - ${runtimeConfig.appName}`;
    if (data.event.kind === 11) {
      const title = getTagValue(data.event, 'title') || getTagValue(data.event, 'subject');
      return `${title || 'Thread'} - ${runtimeConfig.appName}`;
    }
    return `Event - ${runtimeConfig.appName}`;
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
  {#if data.event?.kind === 11 || data.event?.kind === 1}
    <ThreadDetailView event={data.event} parentEvent={data.parentEvent} scrollTo={data.scrollTo} />
  {:else if data.event}
    <div class="alert alert-warning">
      <span>{m.route_unsupported_event_kind({ kind: data.event.kind })}</span>
    </div>
  {:else}
    <div class="alert alert-error">
      <span>{m.route_failed_load_event()}</span>
    </div>
  {/if}
</div>
