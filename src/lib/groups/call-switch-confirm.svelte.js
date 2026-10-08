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
//
// Task 19: the same wrapper also asks before LEAVING a call
// (`confirmCallLeave`, modal type 'callLeaveConfirm', asked by
// `leaveGroupCallWithConfirm`). Both share one pending slot: the modal store
// shows one modal at a time, so a new confirm of either kind settles the
// previous one as cancelled.
import { modalStore } from '$lib/stores/modal.svelte.js';

/** @type {{ resolve: (value: any) => void } | null} */
let active = null;

/**
 * Open a confirm modal and resolve with the answer: the value its onConfirm
 * was called with (true when called bare), `cancelled` on onCancel or on the
 * modal going away any other way.
 * @template T
 * @param {'callSwitchConfirm' | 'callLeaveConfirm' | 'callPreJoin'} type
 * @param {Record<string, unknown>} props
 * @param {T} cancelled
 * @returns {Promise<boolean | T>}
 */
function askModal(type, props, cancelled = /** @type {T} */ (false)) {
  // A confirm is already pending (two attempts raced): settle it as
  // cancelled before replacing its props/callbacks, instead of orphaning it.
  active?.resolve(cancelled);
  active = null;

  return new Promise((resolve) => {
    let settled = false;
    /** @type {() => void} */
    let disposeWatch = () => {};

    /** @param {boolean | T} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (active?.resolve === finish) active = null;
      disposeWatch();
      resolve(value);
    };

    modalStore.openModal(type, props, {
      onConfirm: (/** @type {T | undefined} */ value) => {
        modalStore.closeModal();
        finish(value === undefined ? true : value);
      },
      onCancel: () => {
        modalStore.closeModal();
        finish(cancelled);
      }
    });

    // The modal can also disappear WITHOUT either callback firing — another
    // modal opening on top (overwriting this one's type) or anything calling
    // closeModal() directly. Watch for that instead of leaving the Promise
    // pending forever.
    disposeWatch = $effect.root(() => {
      $effect(() => {
        if (modalStore.activeModal !== type) finish(cancelled);
      });
    });

    active = { resolve: finish };
  });
}

/**
 * Ask whether to leave the call the user is currently in (named `title`) to
 * join a different channel's call instead.
 * @param {string} title - the channel name of the call currently running
 * @returns {Promise<boolean>} true on "Wechseln", false on cancel
 */
export function confirmCallSwitch(title) {
  return /** @type {Promise<boolean>} */ (askModal('callSwitchConfirm', { title }));
}

/**
 * The pre-join lobby ("Bereit für den Anruf?", CallPreJoinModal): the user
 * checks camera and microphone and picks what to join with. Asked by
 * `joinGroupCallWithConfirm` before any token is requested.
 * @param {string} title - the channel the call belongs to
 * @returns {Promise<import('$lib/services/call-prefs.js').JoinMedia | null>}
 *   the chosen media, or null when the lobby was cancelled / dismissed
 */
export function confirmCallJoin(title) {
  return /** @type {Promise<import('$lib/services/call-prefs.js').JoinMedia | null>} */ (
    askModal('callPreJoin', { title }, /** @type {null} */ (null))
  );
}

/**
 * Ask before leaving the running call ("Anruf verlassen?").
 * @param {{ guest: boolean, signal?: AbortSignal }} options - guest: joined
 *   through a call link, which is also the way back (different copy);
 *   signal: dismiss the dialog (resolves false) — the call ended meanwhile
 * @returns {Promise<boolean>} true on "Verlassen", false on cancel
 */
export function confirmCallLeave({ guest, signal }) {
  const answer = /** @type {Promise<boolean>} */ (askModal('callLeaveConfirm', { guest }));
  const dismiss = () => {
    if (modalStore.activeModal === 'callLeaveConfirm') modalStore.closeModal();
  };
  if (signal?.aborted) dismiss();
  else signal?.addEventListener('abort', dismiss, { once: true });
  return answer;
}
