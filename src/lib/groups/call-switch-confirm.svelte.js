// Shared "you're already in a call elsewhere" confirmation. Asked once, by
// `joinGroupCallWithConfirm` (group-call.svelte.js), before switching —
// every member join entry point (chat header, meeting card/bar, channel
// roster's join pill) funnels through that one function, so this is the
// single confirm implementation for all of them. Backed by the app's
// existing modal store + ModalManager registry (CallSwitchConfirmModal),
// rather than a one-off local dialog, so it also fires from entry points
// that are not children of GroupChat (e.g. the channel-list roster).
//
// Only one confirm can be pending at a time (the modal store only shows one
// modal). Review fix round 1: a second confirmCallSwitch() while one is
// still pending used to silently overwrite the first one's modalProps and
// callbacks, orphaning its Promise forever (a caller awaiting it — e.g.
// ChannelCallRoster's `busy` flag — never recovered). Same for the modal
// going away any OTHER way (another modal opening on top, or something
// calling modalStore.closeModal() directly): neither onConfirm nor onCancel
// would fire. A reactive watch on `modalStore.activeModal` (plain .js files
// cannot use runes, hence the .svelte.js extension) resolves false in
// every one of those cases instead of leaving the Promise dangling.
import { modalStore } from '$lib/stores/modal.svelte.js';

/** @type {{ resolve: (value: boolean) => void } | null} */
let active = null;

/**
 * Ask whether to leave the call the user is currently in (named `title`) to
 * join a different channel's call instead.
 * @param {string} title - the channel name of the call currently running
 * @returns {Promise<boolean>} true on "Wechseln", false on cancel
 */
export function confirmCallSwitch(title) {
  // A confirm is already pending (two switch attempts raced): settle it as
  // cancelled before replacing its props/callbacks, instead of orphaning it.
  active?.resolve(false);
  active = null;

  return new Promise((resolve) => {
    let settled = false;
    /** @type {() => void} */
    let disposeWatch = () => {};

    /** @param {boolean} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (active?.resolve === finish) active = null;
      disposeWatch();
      resolve(value);
    };

    modalStore.openModal(
      'callSwitchConfirm',
      { title },
      {
        onConfirm: () => {
          modalStore.closeModal();
          finish(true);
        },
        onCancel: () => {
          modalStore.closeModal();
          finish(false);
        }
      }
    );

    // The modal can also disappear WITHOUT either callback firing — another
    // modal opening on top (overwriting this one's type) or anything calling
    // closeModal() directly. Watch for that instead of leaving the Promise
    // pending forever.
    disposeWatch = $effect.root(() => {
      $effect(() => {
        if (modalStore.activeModal !== 'callSwitchConfirm') finish(false);
      });
    });

    active = { resolve: finish };
  });
}
