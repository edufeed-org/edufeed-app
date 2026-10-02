<!-- LocationInput stand-in: a marked, bound <input>. -->
<script>
  let { value = $bindable('') } = $props();
</script>

<input data-testid="location-input" bind:value />
