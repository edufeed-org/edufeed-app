<script>
  // Stub for AMBResourceSearchInput. Fires onselect with a fixed ref on mount
  // so the test can assert the adapter appends it to the value array.
  let { onselect } = $props();
  $effect(() => {
    onselect({
      coordinate: '30142:abc:res1',
      pubkey: 'abc',
      dTag: 'res1',
      relayHint: 'wss://r',
      event: {}
    });
  });
</script>

<div data-testid="relation-stub"></div>
