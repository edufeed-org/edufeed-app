/**
 * Promote a DaisyUI-styled <dialog> overlay into the browser TOP LAYER.
 *
 * DaisyUI's `.modal` positions the dialog with `position: fixed`, which
 * breaks when the modal is rendered inside another modal's `.modal-box`:
 * the box's transform makes it the containing block, so the "fullscreen"
 * overlay only covers the parent box (edufeed-app#13 feedback). Native
 * `showModal()` escapes any containing block.
 *
 * The host component still owns visibility via `{#if open}`; this action
 * only mirrors native dismissal (ESC) back through `onDismiss` so the
 * component state stays in sync.
 *
 * @param {HTMLDialogElement} node
 * @param {(() => void) | undefined} [onDismiss]
 * @returns {{ destroy: () => void }}
 */
export function topLayerModal(node, onDismiss) {
  if (typeof node.showModal === 'function' && !node.open) {
    node.showModal();
  }

  /** @param {Event} event */
  const handleCancel = (event) => {
    // Keep the dialog element open — the component unmounts it via {#if}.
    event.preventDefault();
    onDismiss?.();
  };
  node.addEventListener('cancel', handleCancel);

  return {
    destroy() {
      node.removeEventListener('cancel', handleCancel);
      if (node.open && typeof node.close === 'function') {
        node.close();
      }
    }
  };
}
