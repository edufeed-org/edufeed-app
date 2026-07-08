<script>
  // Recovery file download dialog. Two modes:
  //   encrypted  → NIP-49 ncryptsec (default; password ≥ 8 chars)
  //   plain      → raw nsec (the file IS the secret — keep it private)
  //
  // Opened from the Termi assistant's backup hint and from the Settings page. After a
  // successful download we set `backup-downloaded:<pubkey>` so the hint
  // stops nagging on subsequent reloads.
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { downloadRecoveryFile } from '$lib/helpers/recoveryFile.js';
  import { markBackupDownloaded } from '$lib/stores/backup-flags.svelte.js';

  let { modalId } = $props();

  const getActiveUser = useActiveUser();

  let mode = $state(/** @type {'encrypted' | 'plain'} */ ('encrypted'));
  let password = $state('');
  let error = $state('');

  /** Sync ESC/backdrop close with the modal store. */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const onClose = () => {
      if (modalStore.activeModal === 'recovery-download') {
        modalStore.closeModal();
      }
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  });

  function handleDownload() {
    error = '';
    const user = getActiveUser();
    // signer.key holds the raw private key bytes for nsec accounts.
    const privateKey = user?.signer?.key;
    if (!user || !privateKey) {
      error = 'No active key-holding account.';
      return;
    }
    const nsec = nip19.nsecEncode(privateKey);

    if (mode === 'encrypted') {
      if (!password || password.length < 8) {
        error = m.auth_recovery_modal_password_too_short();
        return;
      }
      downloadRecoveryFile({ privateKey, nsec, password });
    } else {
      downloadRecoveryFile({ privateKey, nsec });
    }

    markBackupDownloaded(user.pubkey);
    modalStore.closeModal();
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-md">
    <h3 class="mb-2 text-lg font-bold">{m.auth_recovery_modal_title()}</h3>
    <p class="mb-4 text-sm opacity-80">{m.auth_recovery_modal_intro()}</p>

    <div class="space-y-2">
      <label class="label flex cursor-pointer items-center gap-2">
        <input
          data-testid="recovery-mode-encrypted"
          type="radio"
          class="radio radio-sm"
          name="recovery-mode"
          value="encrypted"
          checked={mode === 'encrypted'}
          onchange={() => (mode = 'encrypted')}
        />
        <span class="label-text">{m.auth_recovery_modal_encrypted_label()}</span>
      </label>

      {#if mode === 'encrypted'}
        <div class="form-control pl-8">
          <label class="label" for="recovery-password-input">
            <span class="label-text">{m.auth_recovery_modal_password_label()}</span>
          </label>
          <input
            id="recovery-password-input"
            data-testid="recovery-password"
            type="password"
            class="input-bordered input input-sm w-full"
            bind:value={password}
            minlength="8"
          />
        </div>
      {/if}

      <label class="label flex cursor-pointer items-center gap-2">
        <input
          data-testid="recovery-mode-plain"
          type="radio"
          class="radio radio-sm"
          name="recovery-mode"
          value="plain"
          checked={mode === 'plain'}
          onchange={() => (mode = 'plain')}
        />
        <span class="label-text">{m.auth_recovery_modal_plain_label()}</span>
      </label>
    </div>

    {#if error}
      <div class="mt-3 alert alert-error">
        <span>{error}</span>
      </div>
    {/if}

    <div class="modal-action">
      <form method="dialog">
        <button class="btn btn-ghost">{m.common_cancel()}</button>
      </form>
      <button data-testid="recovery-download-btn" class="btn btn-primary" onclick={handleDownload}>
        {m.auth_recovery_modal_download()}
      </button>
    </div>
  </div>
</dialog>
