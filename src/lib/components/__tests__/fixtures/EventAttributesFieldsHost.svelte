<script>
  import EventAttributesFields from '$lib/components/calendar/EventAttributesFields.svelte';
  /** @type {{ initial?: any }} */
  let { initial = { educationalLevels: [] } } = $props();
  // svelte-ignore state_referenced_locally
  let attributes = $state(initial);
</script>

<EventAttributesFields bind:attributes />
<pre data-testid="attributes-json">{JSON.stringify(attributes)}</pre>
