<!-- Test probe: records the `event` prop it was handed on a global so a test
     can inspect the exact object a parent passes down (e.g. to check it is
     not a Svelte deep-state proxy). Renders a marker only. -->
<script>
  let { event = null } = $props();
  $effect(() => {
    const g = /** @type {any} */ (globalThis);
    if (event) (g.__eventPropProbe ??= []).push(event);
  });
</script>

<span data-testid="event-prop-probe"></span>
