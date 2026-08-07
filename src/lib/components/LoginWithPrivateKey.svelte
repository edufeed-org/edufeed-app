<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { SimpleSigner } from 'applesauce-signers';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { nip19 } from 'nostr-tools';
  import { getPublicKey } from 'nostr-tools/pure';
  import * as nip49 from 'nostr-tools/nip49';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { loadUserProfile } from '$lib/loaders/profile.js';
  import SignupButton from './shared/SignupButton.svelte';
  import * as m from '$lib/paraglide/messages';

  let { modalId, onAccountCreated } = $props();

  let accountLabel = $state('');
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

  /**
   * Derive a stable, recognizable label from the typed nsec to populate the
   * hidden `autocomplete="username"` field. The browser's password manager
   * needs this filled BEFORE form submit to offer a save prompt — otherwise
   * Chrome silently skips the save.
   *
   * Strategy:
   *   1. Decode the nsec synchronously → derive pubkey → use a short npub
   *      (e.g. "npub1abcdefgh…wxyz") as an instant fallback.
   *   2. Fire `loadUserProfile` and, if the user already has a kind 0 published,
   *      upgrade the label to their display name / name.
   *   3. ncryptsec inputs are skipped here (we can't derive pubkey without the
   *      decryption password). Plain-nsec users are the common path.
   */
  $effect(() => {
    const trimmed = inputNSEC.trim();
    if (!trimmed.startsWith('nsec1')) {
      accountLabel = '';
      return;
    }

    let privateKey;
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'nsec') return;
      privateKey = decoded.data;
    } catch {
      accountLabel = '';
      return;
    }

    let pubkey;
    try {
      pubkey = getPublicKey(privateKey);
    } catch {
      accountLabel = '';
      return;
    }

    const npub = nip19.npubEncode(pubkey);
    accountLabel = `${npub.slice(0, 12)}…${npub.slice(-4)}`;

    const sub = loadUserProfile(0, pubkey).subscribe({
      next: (profile) => {
        const name = profile?.display_name || profile?.name;
        if (name) accountLabel = name;
      },
      error: () => {
        // Keep the npub fallback on relay errors.
      }
    });
    return () => sub.unsubscribe();
  });

  /**
   * End the login flow: close this dialog, then tell the parent the flow is
   * done so it can clear the modal store. Order matters — `onAccountCreated`
   * unmounts this component, so anything still on screen (the "already logged
   * in" notice) has to have had its time before we call it.
   */
  function finishLogin() {
    const dialog = /** @type {HTMLDialogElement | null} */ (document.getElementById(modalId));
    dialog?.close?.();
    if (onAccountCreated) onAccountCreated();
  }

  /**
   * Form submit wrapper — prevents the default GET navigation so the browser
   * still fires the "save password?" prompt (it requires a real form submit,
   * not a click handler) but our SPA stays put.
   * @param {SubmitEvent} event
   */
  function handleSubmit(event) {
    event.preventDefault();
    handleLoginWithPrivateKey();
  }

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

      // If this account is already in the manager, switch to the EXISTING object.
      // Building a fresh SimpleAccount and passing it to setActive throws
      // "Cant find account with that ID" because applesauce looks up by id
      // (a fresh nanoid) — that crash was previously surfaced as a misleading
      // "Failed to log in" error.
      const existing = manager.getAccountForPubkey(pk);

      if (existing) {
        manager.setActive(existing);
        infoMessage = m.auth_login_private_key_already_logged_in();
      } else {
        const account = new SimpleAccount(pk, simpleSigner);
        manager.addAccount(account);
        manager.setActive(account);
      }

      if (existing) {
        // Give the user a moment to read the info message before closing.
        closeTimer = setTimeout(finishLogin, 1200);
      } else {
        finishLogin();
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

    <!--
      Real <form> with autocomplete="username" + autocomplete="current-password" so
      browsers offer to save the (label, nsec) pair after submit. The decryption
      password for ncryptsec is marked autocomplete="off" so it isn't captured.
    -->
    <form class="space-y-4" onsubmit={handleSubmit}>
      <!--
        Hidden "username" field for the browser password manager. Auto-populated
        from the typed nsec (short npub immediately, profile name once loaded).
        Browsers need a non-empty `autocomplete="username"` field at submit time
        to offer the "save password?" prompt.
      -->
      <input type="hidden" name="username" autocomplete="username" value={accountLabel} />

      <!-- Private Key Input -->
      <div class="form-control">
        <label class="label" for="nsec-input">
          <span class="label-text">{m.auth_login_private_key_label()}</span>
        </label>
        <input
          id="nsec-input"
          name="nsec"
          bind:value={inputNSEC}
          type="password"
          autocomplete="current-password"
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
            autocomplete="off"
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
      <button type="submit" class="btn w-full btn-primary">
        {m.auth_login_private_key_login_button()}
      </button>
    </form>

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
