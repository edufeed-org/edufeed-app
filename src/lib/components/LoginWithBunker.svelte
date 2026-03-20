<script>
  let { modalId, onAccountCreated, onBack } = $props();

  import QRCode from 'qrcode';
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import {
    validateBunkerUrl,
    connectWithBunkerUrl,
    createClientConnection,
    registerBunkerAccount
  } from '$lib/helpers/bunker-connection.js';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import SignupButton from './shared/SignupButton.svelte';

  let mode = $state('qr');

  // Shared state
  let errorMessage = $state('');
  /** @type {'idle' | 'connecting' | 'awaiting_connection' | 'awaiting_approval' | 'connected' | 'error'} */
  let status = $state('idle');
  /** @type {string | null} */
  let authUrl = $state(null);

  // URL mode state
  let bunkerUrl = $state('');

  // QR mode state
  /** @type {any} */
  let qrSigner = $state(null);
  let nostrConnectUri = $state('');
  /** @type {AbortController | null} */
  let abortController = $state(null);
  let isAborting = false;

  // Canvas element for QR code
  /** @type {HTMLCanvasElement | null} */
  let qrCanvas = $state(null);

  /**
   * Sync modal close with store state
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      if (modalStore.activeModal === 'bunker') {
        modalStore.closeModal();
        cleanup();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /**
   * Initialize QR connection when switching to QR mode
   */
  $effect(() => {
    if (mode === 'qr' && status === 'idle') {
      initQrConnection();
    }
  });

  /**
   * Render QR code when URI and canvas are available
   */
  $effect(() => {
    if (qrCanvas && nostrConnectUri) {
      QRCode.toCanvas(qrCanvas, nostrConnectUri, {
        width: 250,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      }).catch(
        /** @param {Error} err */ (err) => {
          console.error('QR code generation error:', err);
        }
      );
    }
  });

  function cleanup() {
    if (abortController) {
      isAborting = true;
      abortController.abort();
      abortController = null;
    }
    if (qrSigner) {
      try {
        qrSigner.close();
      } catch (_) {
        // ignore
      }
      qrSigner = null;
    }
    status = 'idle';
    errorMessage = '';
    authUrl = null;
    nostrConnectUri = '';
    bunkerUrl = '';
  }

  function getRelays() {
    return runtimeConfig.fallbackRelays?.length > 0
      ? runtimeConfig.fallbackRelays
      : ['wss://relay.nsec.app'];
  }

  async function initQrConnection() {
    errorMessage = '';
    authUrl = null;
    isAborting = false;

    try {
      const relays = getRelays();

      const connection = createClientConnection(relays, {
        pool,
        onAuth: async (url) => {
          authUrl = url;
          status = 'awaiting_approval';
        },
        appMetadata: {
          name: 'ComCal',
          url: window.location.origin
        }
      });

      qrSigner = connection.signer;
      nostrConnectUri = connection.uri;
      status = 'awaiting_connection';

      await connection.open();
      abortController = new AbortController();
      await connection.waitForSigner(abortController.signal);

      const pubkey = await qrSigner.getPublicKey();
      status = 'connected';

      registerBunkerAccount(manager, pubkey, qrSigner);
      qrSigner = null;
      nostrConnectUri = '';

      if (onAccountCreated) {
        onAccountCreated();
      }
    } catch (error) {
      if (isAborting || /** @type {Error} */ (error).name === 'AbortError') {
        isAborting = false;
        status = 'idle';
        return;
      }
      console.error('QR connection error:', error);
      status = 'error';
      errorMessage = /** @type {Error} */ (error).message || 'Failed to connect';
    }
  }

  function regenerateQr() {
    if (abortController) {
      isAborting = true;
      abortController.abort();
      abortController = null;
    }
    if (qrSigner) {
      try {
        qrSigner.close();
      } catch (_) {
        // ignore
      }
      qrSigner = null;
    }
    status = 'idle';
    nostrConnectUri = '';
  }

  async function handleUrlConnect() {
    errorMessage = '';
    authUrl = null;

    const validation = validateBunkerUrl(bunkerUrl);
    if (!validation.valid) {
      errorMessage = validation.error || '';
      return;
    }

    status = 'connecting';

    try {
      const result = await connectWithBunkerUrl(bunkerUrl.trim(), {
        pool,
        onAuth: async (url) => {
          authUrl = url;
          status = 'awaiting_approval';
        }
      });

      status = 'connected';
      registerBunkerAccount(manager, result.pubkey, result.signer);
      bunkerUrl = '';

      if (onAccountCreated) {
        onAccountCreated();
      }
    } catch (error) {
      console.error('Bunker connection error:', error);
      status = 'error';
      errorMessage = /** @type {Error} */ (error).message || 'Failed to connect to bunker';
    }
  }

  function openAuthUrl() {
    if (authUrl) {
      window.open(authUrl, '_blank');
    }
  }

  /** @param {'qr' | 'url'} newMode */
  function switchMode(newMode) {
    if (newMode === mode) return;

    if (mode === 'qr' && abortController) {
      isAborting = true;
      abortController.abort();
      abortController = null;
    }
    if (qrSigner) {
      try {
        qrSigner.close();
      } catch (_) {
        // ignore
      }
      qrSigner = null;
    }

    mode = newMode;
    status = 'idle';
    errorMessage = '';
    authUrl = null;
    nostrConnectUri = '';
  }

  function getStatusText() {
    switch (status) {
      case 'connecting':
        return m.auth_bunker_status_connecting();
      case 'awaiting_connection':
        return m.auth_bunker_status_awaiting_connection();
      case 'awaiting_approval':
        return m.auth_bunker_status_awaiting_approval();
      case 'connected':
        return m.auth_bunker_status_connected();
      case 'error':
        return m.auth_bunker_status_error();
      default:
        return '';
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <div class="mb-4 flex items-center gap-2">
      {#if onBack}
        <button onclick={onBack} class="btn btn-circle btn-ghost btn-sm">
          <ChevronLeftIcon class_="w-5 h-5" />
        </button>
      {/if}
      <h1 class="text-lg font-bold">{m.auth_bunker_title()}</h1>
    </div>

    <!-- Mode Selector -->
    <div class="mb-4 flex justify-center">
      <div class="join">
        <input
          class="btn join-item"
          type="radio"
          name="bunker-login-mode"
          aria-label={m.auth_bunker_tab_qr()}
          checked={mode === 'qr'}
          onchange={() => switchMode('qr')}
        />
        <input
          class="btn join-item"
          type="radio"
          name="bunker-login-mode"
          aria-label={m.auth_bunker_tab_url()}
          checked={mode === 'url'}
          onchange={() => switchMode('url')}
        />
      </div>
    </div>

    {#if mode === 'qr'}
      <!-- QR Code Tab -->
      <div class="space-y-4">
        <p class="text-center text-sm text-base-content/70">
          {m.auth_bunker_qr_description()}
        </p>

        <div class="flex justify-center">
          {#if nostrConnectUri}
            <div class="rounded-lg bg-white p-4">
              <canvas bind:this={qrCanvas} aria-label="QR code for Nostr Connect"></canvas>
            </div>
          {:else}
            <div
              class="flex h-[250px] w-[250px] items-center justify-center rounded-lg bg-base-200"
            >
              <span class="loading loading-lg loading-spinner"></span>
            </div>
          {/if}
        </div>

        <!-- Status -->
        {#if status === 'awaiting_connection' || status === 'awaiting_approval'}
          <div class="flex items-center justify-center gap-2">
            <span class="loading loading-sm loading-spinner"></span>
            <span class="text-sm">{getStatusText()}</span>
          </div>
        {:else if status === 'connected'}
          <div class="flex items-center justify-center gap-2 text-success">
            <span class="text-sm">{getStatusText()}</span>
          </div>
        {:else if status === 'error'}
          <div class="flex items-center justify-center gap-2 text-error">
            <span class="text-sm">{getStatusText()}</span>
          </div>
        {/if}

        <!-- Auth URL button -->
        {#if authUrl && status === 'awaiting_approval'}
          <div class="alert alert-info">
            <div>
              <p class="text-sm">{m.auth_bunker_auth_required()}</p>
              <button onclick={openAuthUrl} class="btn mt-2 btn-sm btn-primary">
                {m.auth_bunker_auth_open()}
              </button>
            </div>
          </div>
        {/if}

        {#if errorMessage}
          <div class="alert alert-error">
            <span>{errorMessage}</span>
          </div>
        {/if}

        {#if status === 'error' || (status !== 'connected' && nostrConnectUri)}
          <div class="flex justify-center">
            <button class="btn btn-outline btn-sm" onclick={regenerateQr}>
              {m.auth_bunker_qr_regenerate()}
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <!-- URL Tab -->
      <div class="space-y-4">
        <p class="text-sm text-base-content/70">
          {m.auth_bunker_url_description()}
        </p>

        <div class="form-control">
          <label class="label" for="bunker-url-input">
            <span class="label-text">{m.auth_bunker_url_label()}</span>
          </label>
          <input
            id="bunker-url-input"
            bind:value={bunkerUrl}
            type="text"
            placeholder={m.auth_bunker_url_placeholder()}
            class="input-bordered input w-full"
            class:input-error={errorMessage}
            disabled={status === 'connecting' || status === 'awaiting_approval'}
          />
          <label class="label" for="bunker-url-input">
            <span class="label-text-alt text-base-content/60">
              {m.auth_bunker_url_help()}
            </span>
          </label>
        </div>

        <!-- Status -->
        {#if status !== 'idle'}
          <div class="flex items-center gap-2">
            {#if status === 'connecting' || status === 'awaiting_approval'}
              <span class="loading loading-sm loading-spinner"></span>
            {/if}
            <span class="text-sm">{getStatusText()}</span>
          </div>
        {/if}

        <!-- Auth URL button -->
        {#if authUrl && status === 'awaiting_approval'}
          <div class="alert alert-info">
            <div>
              <p class="text-sm">{m.auth_bunker_auth_required()}</p>
              <button onclick={openAuthUrl} class="btn mt-2 btn-sm btn-primary">
                {m.auth_bunker_auth_open()}
              </button>
            </div>
          </div>
        {/if}

        {#if errorMessage}
          <div class="alert alert-error">
            <span>{errorMessage}</span>
          </div>
        {/if}

        <button
          class="btn w-full btn-primary"
          onclick={handleUrlConnect}
          disabled={status === 'connecting' || status === 'awaiting_approval'}
        >
          {#if status === 'connecting' || status === 'awaiting_approval'}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {status === 'idle' || status === 'error'
            ? m.auth_bunker_url_connect()
            : m.auth_bunker_status_connecting()}
        </button>
      </div>
    {/if}

    <div class="divider">{m.auth_login_modal_or()}</div>

    <div class="text-center">
      <h2 class="mb-2 text-lg font-bold">{m.auth_login_modal_no_account()}</h2>
      <SignupButton class="w-full" />
    </div>

    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
</dialog>
