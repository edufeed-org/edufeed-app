<script>
  // Stub for ExternalUrlInput. The label conditional below MUST reproduce the
  // REAL component's post-fix behavior — plain `{#if label}` (no i18n fallback)
  // — so a `label=""` suppress path is exercised faithfully and the composition
  // test can't pass falsely (the earlier fallback `label || m.external_url_label()`
  // in the real component always rendered a label; the ExternalUrlFieldAdapter.real
  // test guards against that regression with the unmocked component).
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
