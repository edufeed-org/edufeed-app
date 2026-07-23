<script>
  // Stub for AMBResourceSearchInput. Fires onselect with a fixed ref only when
  // the button is clicked (NOT on mount) so tests can distinguish a real pick
  // from any spurious mount-time onchange.
  let { onselect } = $props();
</script>

<button
  type="button"
  data-testid="relation-stub-pick"
  onclick={() =>
    onselect({
      coordinate: '30142:abc:res1',
      pubkey: 'abc',
      dTag: 'res1',
      relayHint: 'wss://r',
      event: {}
    })}
>
  pick
</button>
