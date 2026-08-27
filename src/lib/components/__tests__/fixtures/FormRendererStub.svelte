<!--
  Stub for FormRenderer.svelte, used by FormRespondRoute.test.js. Exposes a
  single text input (so a test can "type" into it) and a Submit button that
  calls onsubmit with whatever was typed — standing in for the real
  component keeps that test focused on the route's own error-state wiring
  rather than FieldsRenderer/branching internals.
-->
<script>
  /** @type {{ onsubmit?: (values: Record<string, any>) => void }} */
  let { onsubmit } = $props();

  let fullName = $state('');
</script>

<div data-testid="form-renderer-stub">
  <input aria-label="full_name" bind:value={fullName} />
  <button type="button" onclick={() => onsubmit?.({ full_name: fullName })}>Submit</button>
</div>
