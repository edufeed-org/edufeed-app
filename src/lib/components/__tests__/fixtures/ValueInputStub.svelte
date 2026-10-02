<!-- Plain bound <input> standing in for EuropeanDateInput/EuropeanTimeInput. -->
<script>
  let { id = '', value = $bindable(''), required = false } = $props();
</script>

<input {id} bind:value {required} />
