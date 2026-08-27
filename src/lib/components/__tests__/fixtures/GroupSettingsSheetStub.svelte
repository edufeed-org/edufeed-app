<!--
  Stub for GroupSettingsSheet — lets GroupChat tests drive onClose/onDeleted
  directly without exercising the sheet's own form/publish internals (those
  are covered by GroupSettingsSheet.test.js).
-->
<script>
  let { onClose, onDeleted } = $props();
</script>

<button data-testid="stub-settings-close" onclick={() => onClose?.()}>close</button>
<button data-testid="stub-settings-trigger-deleted" onclick={() => onDeleted?.()}>delete</button>
