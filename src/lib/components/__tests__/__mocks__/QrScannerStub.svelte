<script>
  // @ts-nocheck
  // Stand-in for the camera scanner: a button that reports whatever payload
  // the test put into `globalThis.__qrScanPayload`, and records the parent's
  // verdict so tests can see whether the scanner would have stopped.
  let { onResult, onCancel } = $props();
  let handled = $state('');
  function emit() {
    handled = String(onResult(globalThis.__qrScanPayload));
  }
</script>

<div data-testid="scanner-stub" data-handled={handled}>
  <button type="button" data-testid="scanner-emit" onclick={emit}>emit</button>
  <button type="button" data-testid="scanner-cancel" onclick={onCancel}>cancel</button>
</div>
