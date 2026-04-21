<script>
  let { modalId, onNSECTransition, onBunkerTransition } = $props();

  import * as m from '$lib/paraglide/messages';
  import { ExtensionSigner } from 'applesauce-signers';
  import { signer } from '$lib/stores/accounts.svelte';

  import { manager } from '$lib/stores/accounts.svelte';
  import { ExtensionAccount } from 'applesauce-accounts/accounts';
  import AccountProfile from './AccountProfile.svelte';
  import { useAccounts } from '$lib/stores/accounts.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import SignupButton from './shared/SignupButton.svelte';

  const getAccounts = useAccounts();

  /**
   * Sync modal close with store state
   * This effect ensures that when the dialog closes (via ESC, backdrop, etc.),
   * the modal store state is updated accordingly
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      // Only update store if this modal is currently active
      if (modalStore.activeModal === 'login') {
        console.log('LoginModal: Dialog closed, syncing with store');
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /** @param {string} selectedSigner */
  async function createSigner(selectedSigner) {
    switch (selectedSigner) {
      case 'Extension': {
        /** @type {any} */ (signer).signer = new ExtensionSigner();
        const pk = await /** @type {any} */ (signer).signer.getPublicKey();
        const account = new ExtensionAccount(pk, /** @type {any} */ (signer).signer);

        if (!manager.getAccountForPubkey(pk)) {
          manager.addAccount(account);
          manager.setActive(account);
        }

        modalStore.closeModal();
        break;
      }
      case 'NSEC':
        if (onNSECTransition) {
          onNSECTransition();
        }
        return null;
      case 'Bunker':
        if (onBunkerTransition) {
          onBunkerTransition();
        }
        return null;
      default:
        throw new Error('Unknown signer');
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_modal_add_account()}</h1>
    <p class="py-4">{m.auth_login_modal_choose_method()}</p>

    <div class="space-y-4">
      <div class="join flex flex-col">
        <button onclick={() => createSigner('Extension')} class="btn join-item"
          >{m.auth_login_modal_extension()}</button
        >
        <button onclick={() => createSigner('NSEC')} class="btn join-item"
          >{m.auth_login_modal_nsec()}</button
        >
        <button onclick={() => createSigner('Bunker')} class="btn join-item"
          >{m.auth_login_modal_bunker()}</button
        >
      </div>

      <div class="divider">{m.auth_login_modal_or()}</div>

      <div class="text-center">
        <h2 class="mb-2 text-lg font-bold">{m.auth_login_modal_no_account()}</h2>
        <SignupButton class="w-full" />
      </div>

      {#if getAccounts().length > 0}
        <div class="divider">{m.auth_login_modal_available_accounts()}</div>
        <ul class="space-y-2">
          {#each getAccounts() as account (account.id)}
            <AccountProfile {account} />
          {/each}
        </ul>
      {/if}
    </div>

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
