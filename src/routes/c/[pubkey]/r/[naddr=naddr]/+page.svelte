<script>
  import AMBResourceView from '$lib/components/educational/AMBResourceView.svelte';
  import { formatAMBResource } from '$lib/helpers/educational';

  /** @type {{ data: any }} */
  let { data } = $props();

  const resource = $derived(data.event ? formatAMBResource(data.event) : null);
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  {#if data.event && resource}
    <AMBResourceView event={data.event} {resource} />
  {/if}
</div>
