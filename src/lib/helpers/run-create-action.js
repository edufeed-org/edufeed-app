/**
 * Shared create-action runner — the FAB's `runAction` body (minus the sheet
 * close), reused by Termi so it can run the same CREATE_ACTIONS entries.
 */
import { modalStore } from '$lib/stores/modal.svelte.js';
import { manager } from '$lib/stores/accounts.svelte';
import { requireSigningOrToast } from '$lib/helpers/signing-guard.js';
import { startResourceCreation } from '$lib/helpers/contentCreation.js';

/**
 * @param {import('$lib/config/create-actions.js').CreateAction} action
 * @param {{ communityPubkey?: string, goto: (url: string) => void, resolve: (path: string) => string }} ctx
 * @returns {boolean} false when a readonly active account blocked the run (toast shown)
 */
export function runCreateAction(action, { communityPubkey, goto, resolve }) {
  // Readonly accounts get the upgrade prompt; anonymous users keep the
  // existing per-action behavior (login prompts inside the flows).
  if (manager.active && !requireSigningOrToast(manager.active)) {
    return false;
  }
  action.run({
    communityPubkey,
    openModal: (name, props) =>
      modalStore.openModal(
        /** @type {import('$lib/stores/modal.svelte.js').ModalType} */ (name),
        props
      ),
    goto,
    resolve,
    startResourceCreation: () => startResourceCreation({ communityPubkey })
  });
  return true;
}
