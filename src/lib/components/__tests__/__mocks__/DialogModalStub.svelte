<script>
  // Minimal stand-in for a <dialog>-based global modal: renders the id the
  // ModalManager looks up, so tests can check that the manager mounts it lazily
  // and calls showModal() once it is in the DOM.
  let { modalId = 'stub-modal', ...rest } = $props();
  const extraProps = Object.keys(rest).sort().join(',');
</script>

<dialog id={modalId} data-testid="dialog-stub" data-props={extraProps}>stub modal</dialog>
