// @ts-nocheck
/**
 * topLayerModal action tests (edufeed-app#13 feedback)
 *
 * Nested overlays must escape transformed ancestors via the native dialog
 * top layer, and native ESC dismissal must flow back to the component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { topLayerModal } from '$lib/actions/topLayerModal.js';

function fakeDialog() {
  const dialog = document.createElement('dialog');
  dialog.showModal = vi.fn(() => {
    dialog.setAttribute('open', '');
  });
  dialog.close = vi.fn(() => {
    dialog.removeAttribute('open');
  });
  return dialog;
}

describe('topLayerModal', () => {
  it('opens the dialog in the top layer on mount', () => {
    const dialog = fakeDialog();
    topLayerModal(dialog);
    expect(dialog.showModal).toHaveBeenCalledOnce();
  });

  it('mirrors native ESC dismissal to onDismiss without closing the element itself', () => {
    const dialog = fakeDialog();
    const onDismiss = vi.fn();
    topLayerModal(dialog, onDismiss);

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(cancel.defaultPrevented).toBe(true);
  });

  it('closes the dialog and unhooks on destroy', () => {
    const dialog = fakeDialog();
    const onDismiss = vi.fn();
    const action = topLayerModal(dialog, onDismiss);

    action.destroy();
    expect(dialog.close).toHaveBeenCalledOnce();

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
