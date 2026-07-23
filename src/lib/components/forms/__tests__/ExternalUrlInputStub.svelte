<script>
  // Stub for ExternalUrlInput. Renders its `label` prop when truthy so tests can
  // detect a duplicated heading (FieldsRenderer already renders the label).
  // Fires onchange only on button click (never on mount) so tests can
  // distinguish a real user action from any spurious mount-time onchange.
  let { urls = [], label = '', onchange } = $props();
</script>

<div data-testid="external-url-stub">
  {#if label}<span>{label}</span>{/if}
  <button
    type="button"
    data-testid="external-url-stub-add"
    onclick={() => onchange([...urls, 'https://a.example'])}
  >
    add
  </button>
  {urls.length}
</div>
