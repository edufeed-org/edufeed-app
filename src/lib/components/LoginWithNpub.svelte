<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { ReadonlyAccount } from 'applesauce-accounts/accounts';
  import { nip19 } from 'nostr-tools';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import * as m from '$lib/paraglide/messages';

  let { modalId, onAccountCreated } = $props();

  let input = $state('');
  let errorMessage = $state('');
  let infoMessage = $state('');

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let closeTimer;

  // Sync modal close with store state (same pattern as LoginWithPrivateKey).
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const handleDialogClose = () => {
      if (modalStore.activeModal === 'npubLogin') {
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
   * Normalize npub or 64-char hex input to a hex pubkey, or null when invalid.
   * @param {string} value
   * @returns {string | null}
   */
  function normalizeToHex(value) {
    const trimmed = value.trim();
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (!trimmed.startsWith('npub1')) return null;
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  /** @param {SubmitEvent} event */
  function handleSubmit(event) {
    event.preventDefault();
    errorMessage = '';
    infoMessage = '';

    const pubkey = normalizeToHex(input);
    if (!pubkey) {
      errorMessage = m.auth_login_npub_error_invalid();
      return;
    }

    // Add-or-activate: setActive looks accounts up by id, so an existing
    // pubkey must reuse the EXISTING account reference (see LoginWithPrivateKey).
    const existing = manager.getAccountForPubkey(pubkey);
    if (existing) {
      manager.setActive(existing);
      infoMessage = m.auth_login_npub_already_added();
    } else {
      const account = ReadonlyAccount.fromPubkey(pubkey);
      manager.addAccount(account);
      manager.setActive(account);
    }

    if (onAccountCreated) onAccountCreated();

    const modal = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (modal) {
      if (existing) {
        closeTimer = setTimeout(() => modal.close?.(), 1200);
      } else {
        modal.close?.();
      }
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_npub_title()}</h1>
    <p class="py-4">{m.auth_login_npub_description()}</p>

    <form class="space-y-4" data-testid="npub-login-form" onsubmit={handleSubmit}>
      <div class="form-control">
        <label class="label" for="npub-input">
          <span class="label-text">{m.auth_login_npub_label()}</span>
        </label>
        <input
          id="npub-input"
          data-testid="npub-input"
          bind:value={input}
          type="text"
          autocomplete="off"
          placeholder={m.auth_login_npub_placeholder()}
          class="input-bordered input w-full"
          class:input-error={errorMessage}
        />
      </div>

      {#if infoMessage}
        <div class="alert alert-info"><span>{infoMessage}</span></div>
      {/if}
      {#if errorMessage}
        <div class="alert alert-error"><span>{errorMessage}</span></div>
      {/if}

      <button type="submit" data-testid="npub-login-submit" class="btn w-full btn-primary">
        {m.auth_login_npub_button()}
      </button>
    </form>

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
