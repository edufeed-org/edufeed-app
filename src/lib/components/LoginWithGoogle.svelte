<script>
  import * as m from '$lib/paraglide/messages';
  import { nip19 } from 'nostr-tools';
  import { manager } from '$lib/stores/accounts.svelte';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { connectWithBunkerUrl, registerBunkerAccount } from '$lib/helpers/bunker-connection.js';
  import { downloadRecoveryFile } from '$lib/helpers/recoveryFile.js';
  import { GoogleIcon } from '$lib/components/icons';
  import {
    startGoogleLogin,
    finishGoogleLogin,
    defaultThreshold,
    generateSecretKey
  } from '$lib/services/pomegranate.js';

  let { modalId } = $props();

  /** @type {'idle' | 'authenticating' | 'backup' | 'creating' | 'connecting'} */
  let status = $state('idle');
  let errorMessage = $state('');
  let copied = $state(false);

  // Raw refs — Uint8Array must not be deep-proxied (see CLAUDE.md).
  let newSecretKey = $state.raw(/** @type {Uint8Array | null} */ (null));
  let newNsec = $state('');
  /** @type {import('$lib/services/pomegranate.js').GoogleToken | null} */
  let token = $state.raw(null);

  const centralUrl = $derived(runtimeConfig.googleLogin?.centralUrl || '');
  const operatorUrls = $derived(runtimeConfig.googleLogin?.operatorUrls || []);

  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const handleDialogClose = () => {
      if (modalStore.activeModal === 'googleLogin') {
        modalStore.closeModal();
      }
    };
    dialog.addEventListener('close', handleDialogClose);
    return () => dialog.removeEventListener('close', handleDialogClose);
  });

  /** @param {unknown} err */
  function surfaceError(err) {
    const name = /** @type {Error} */ (err)?.name || '';
    if (name === 'PomegranatePopupBlockedError') {
      errorMessage = m.auth_login_google_error_popup_blocked();
    } else if (name === 'PomegranatePopupClosedError') {
      errorMessage = m.auth_login_google_error_popup_closed();
    } else {
      errorMessage = /** @type {Error} */ (err)?.message || m.auth_login_google_error_generic();
    }
    status = 'idle';
    console.warn('Google login failed:', err);
  }

  /** Popup must open from this click handler (user gesture). */
  async function start() {
    errorMessage = '';
    status = 'authenticating';
    try {
      const result = await startGoogleLogin(centralUrl);
      token = result.token;
      if (result.hasAccount) {
        await loginWithBunker(null);
      } else {
        newSecretKey = generateSecretKey();
        newNsec = nip19.nsecEncode(newSecretKey);
        status = 'backup';
      }
    } catch (err) {
      surfaceError(err);
    }
  }

  /**
   * Finish login. `config` is null for existing accounts, or the new-account
   * creation config. On success the account is registered through the normal
   * bunker path and tagged with the central URL.
   * @param {{ operators: string[], threshold: number, secretKey: Uint8Array } | null} config
   */
  async function loginWithBunker(config) {
    if (!token) return;
    status = config ? 'creating' : 'connecting';
    const isNew = !!config;
    const { bunkerUrl, central } = await finishGoogleLogin(centralUrl, token, config);
    status = 'connecting';
    const { signer, pubkey } = await connectWithBunkerUrl(bunkerUrl, { pool });
    const { account } = registerBunkerAccount(manager, pubkey, signer);
    account.metadata = { ...(account.metadata || {}), pomegranateCentral: central };
    // manager.accounts$ only emits on account add/remove, not on metadata
    // mutation, so localStorage persistence (subscribed in AccountManager.svelte)
    // never fires for this change — save manually or the Google tag (and the
    // badge/export UI that reads it) is lost on reload.
    try {
      localStorage.setItem('accounts', JSON.stringify(manager.toJSON()));
    } catch (err) {
      console.warn('Failed to persist account metadata:', err);
    }
    newSecretKey = null;
    newNsec = '';
    if (isNew) {
      // Hand the fresh account to the signup wizard (profile → communities →
      // publish defaults). The wizard reads the active account (externalSignup).
      modalStore.transitionModal('googleLogin', 'signup', { externalSignup: true });
    } else {
      modalStore.closeModal();
    }
  }

  /** Create the account (backup step's Continue/Skip both land here). */
  async function createAccount() {
    if (!newSecretKey) return;
    errorMessage = '';
    try {
      await loginWithBunker({
        operators: operatorUrls,
        threshold: defaultThreshold(operatorUrls.length),
        secretKey: newSecretKey
      });
    } catch (err) {
      surfaceError(err);
    }
  }

  async function copyNsec() {
    try {
      await navigator.clipboard.writeText(newNsec);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }

  function downloadBackup() {
    if (!newSecretKey) return;
    downloadRecoveryFile({ privateKey: newSecretKey, nsec: newNsec });
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <h1 class="text-lg font-bold">{m.auth_login_google_title()}</h1>

    {#if status === 'idle'}
      <p class="py-4">{m.auth_login_google_intro()}</p>
      {#if errorMessage}
        <div class="mb-4 alert alert-error"><span class="text-sm">{errorMessage}</span></div>
      {/if}
      <button data-testid="google-login-start" class="btn w-full btn-primary" onclick={start}>
        <GoogleIcon />
        {m.auth_login_google_start()}
      </button>
    {:else if status === 'backup'}
      <div class="space-y-4 py-4" data-testid="google-backup-step">
        <h2 class="font-semibold">{m.auth_login_google_backup_title()}</h2>
        <p class="text-sm opacity-80">{m.auth_login_google_backup_description()}</p>
        <div class="flex items-center gap-2">
          <input
            class="input-bordered input w-full font-mono text-xs"
            readonly
            value={newNsec}
            data-testid="google-backup-nsec"
          />
          <button class="btn btn-sm" onclick={copyNsec}>
            {copied ? m.auth_login_google_backup_copied() : m.auth_login_google_backup_copy()}
          </button>
        </div>
        <button class="btn w-full btn-outline" onclick={downloadBackup}>
          {m.auth_login_google_backup_download()}
        </button>
        {#if errorMessage}
          <div class="alert alert-error"><span class="text-sm">{errorMessage}</span></div>
        {/if}
        <div class="flex justify-end gap-2">
          <button data-testid="google-backup-skip" class="btn btn-ghost" onclick={createAccount}>
            {m.auth_login_google_backup_skip()}
          </button>
          <button
            data-testid="google-backup-continue"
            class="btn btn-primary"
            onclick={createAccount}
          >
            {m.auth_login_google_backup_continue()}
          </button>
        </div>
      </div>
    {:else}
      <div class="flex flex-col items-center gap-3 py-8" data-testid="google-login-progress">
        <span class="loading loading-lg loading-spinner"></span>
        <span class="text-sm opacity-80">
          {#if status === 'authenticating'}{m.auth_login_google_status_authenticating()}
          {:else if status === 'creating'}{m.auth_login_google_status_creating()}
          {:else}{m.auth_login_google_status_connecting()}{/if}
        </span>
      </div>
    {/if}

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
