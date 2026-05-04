<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleSigner } from 'applesauce-signers';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { nip19 } from 'nostr-tools';
  import * as nip49 from 'nostr-tools/nip49';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import SignupButton from './shared/SignupButton.svelte';
  import * as m from '$lib/paraglide/messages';

  let { modalId, onAccountCreated } = $props();

  let inputNSEC = $state('');
  let password = $state('');
  let errorMessage = $state('');
  let infoMessage = $state('');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let closeTimer;

  // Detect if input is ncryptsec format
  let isNcryptsec = $derived(inputNSEC.trim().startsWith('ncryptsec1'));

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
      if (modalStore.activeModal === 'privateKey') {
        console.log('LoginWithPrivateKey: Dialog closed, syncing with store');
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
      }
    };
  });

  async function handleLoginWithPrivateKey() {
    let privateKey;
    errorMessage = '';
    infoMessage = '';

    try {
      const trimmedInput = inputNSEC.trim();

      // Check if it's an encrypted key (ncryptsec)
      if (trimmedInput.startsWith('ncryptsec1')) {
        if (!password) {
          errorMessage = m.auth_login_private_key_error_password_required();
          return;
        }

        try {
          // Decrypt the ncryptsec with the provided password
          privateKey = nip49.decrypt(trimmedInput, password);
          console.log('Successfully decrypted ncryptsec');
        } catch (decryptError) {
          console.error('Decryption error:', decryptError);
          errorMessage = m.auth_login_private_key_error_decrypt_failed();
          return;
        }
      } else {
        // Try to decode as regular nsec
        const decoded = nip19.decode(trimmedInput);
        if (decoded.type !== 'nsec') {
          errorMessage = m.auth_login_private_key_error_invalid_format();
          return;
        }
        privateKey = decoded.data;
      }

      // Create signer and derive the public key
      const simpleSigner = new SimpleSigner(privateKey);
      const pk = await simpleSigner.getPublicKey();
      console.log('Public Key:', pk);

      // If this account is already in the manager, switch to the EXISTING object.
      // Building a fresh SimpleAccount and passing it to setActive throws
      // "Cant find account with that ID" because applesauce looks up by id
      // (a fresh nanoid) — that crash was previously surfaced as a misleading
      // "Failed to log in" error.
      const existing = manager.getAccountForPubkey(pk);

      if (existing) {
        manager.setActive(existing);
        infoMessage = m.auth_login_private_key_already_logged_in();
        console.log('LoginWithPrivateKey: Existing account set active:', existing);
      } else {
        const account = new SimpleAccount(pk, simpleSigner);
        manager.addAccount(account);
        manager.setActive(account);
        console.log('LoginWithPrivateKey: New account created and set active:', account);
      }

      console.log('LoginWithPrivateKey: Current active account:', manager.active);
      console.log('LoginWithPrivateKey: All accounts:', manager.accounts);

      // Call the callback to notify parent component of successful account creation
      if (onAccountCreated) {
        onAccountCreated();
      }

      const modal = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
      if (modal) {
        if (existing) {
          // Give the user a moment to read the info message before closing.
          closeTimer = setTimeout(() => modal.close?.(), 1200);
        } else {
          modal.close?.();
        }
      }
    } catch (error) {
      console.error('Error logging in with private key:', error);
      errorMessage = m.auth_login_private_key_error_login_failed();
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_private_key_title()}</h1>
    <p class="py-4">{m.auth_login_private_key_description()}</p>

    <div class="space-y-4">
      <!-- Private Key Input -->
      <div class="form-control">
        <label class="label" for="nsec-input">
          <span class="label-text">{m.auth_login_private_key_label()}</span>
        </label>
        <input
          id="nsec-input"
          bind:value={inputNSEC}
          type="text"
          placeholder={m.auth_login_private_key_placeholder()}
          class="input-bordered input w-full"
          class:input-error={errorMessage}
        />
      </div>

      <!-- Password Input (shown only for ncryptsec) -->
      {#if isNcryptsec}
        <div class="form-control">
          <label class="label" for="password-input">
            <span class="label-text">{m.auth_login_private_key_password_label()}</span>
          </label>
          <input
            id="password-input"
            bind:value={password}
            type="password"
            placeholder={m.auth_login_private_key_password_placeholder()}
            class="input-bordered input w-full"
            class:input-error={errorMessage}
          />
          <div class="label">
            <span class="label-text-alt">{m.auth_login_private_key_password_help()}</span>
          </div>
        </div>
      {/if}

      <!-- Info Message (e.g. account already logged in) -->
      {#if infoMessage}
        <div class="alert alert-info">
          <span>{infoMessage}</span>
        </div>
      {/if}

      <!-- Error Message -->
      {#if errorMessage}
        <div class="alert alert-error">
          <span>{errorMessage}</span>
        </div>
      {/if}

      <!-- Login Button -->
      <button class="btn w-full btn-primary" onclick={handleLoginWithPrivateKey}>
        {m.auth_login_private_key_login_button()}
      </button>
    </div>

    <div class="divider">{m.auth_login_modal_or()}</div>

    <div class="text-center">
      <h2 class="mb-2 text-lg font-bold">{m.auth_login_private_key_no_account()}</h2>
      <SignupButton class="w-full" />
    </div>

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
