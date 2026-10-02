// Shared "you're already in a call elsewhere" confirmation. Asked once, by
// `joinGroupCallWithConfirm` (group-call.svelte.js), before switching —
// every member join entry point (chat header, meeting card/bar, channel
// roster's join pill) funnels through that one function, so this is the
// single confirm implementation for all of them. Backed by the app's
// existing modal store + ModalManager registry (CallSwitchConfirmModal),
// rather than a one-off local dialog, so it also fires from entry points
// that are not children of GroupChat (e.g. the channel-list roster).
import { modalStore } from '$lib/stores/modal.svelte.js';

/**
 * Ask whether to leave the call the user is currently in (named `title`) to
 * join a different channel's call instead.
 * @param {string} title - the channel name of the call currently running
 * @returns {Promise<boolean>} true on "Wechseln", false on cancel
 */
export function confirmCallSwitch(title) {
  return new Promise((resolve) => {
    modalStore.openModal(
      'callSwitchConfirm',
      { title },
      {
        onConfirm: () => {
          modalStore.closeModal();
          resolve(true);
        },
        onCancel: () => {
          modalStore.closeModal();
          resolve(false);
        }
      }
    );
  });
}
