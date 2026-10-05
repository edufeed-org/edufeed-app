<!-- LocationInput stand-in: a marked, bound <input> plus its label/placeholder. -->
<script>
  let { value = $bindable(''), label = '', placeholder = '' } = $props();
</script>

<span data-testid="location-label">{label}</span>
<input data-testid="location-input" {placeholder} bind:value />
