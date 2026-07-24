<script>
  let { modalId, onNSECTransition, onBunkerTransition, onNpubTransition, onGoogleTransition } =
    $props();

  import * as m from '$lib/paraglide/messages';
  import { ExtensionSigner } from 'applesauce-signers';
  import { signer } from '$lib/stores/accounts.svelte';

  import { manager } from '$lib/stores/accounts.svelte';
  import { ExtensionAccount } from 'applesauce-accounts/accounts';
  import AccountProfile from './AccountProfile.svelte';
  import { useAccounts } from '$lib/stores/accounts.svelte.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import {
    CloseIcon,
    GoogleIcon,
    KeyIcon,
    PuzzleIcon,
    SmartphoneIcon
  } from '$lib/components/icons';

  const getAccounts = useAccounts();

  /**
   * User-facing error from the Extension flow. Surfaced inline in the modal so
   * a missing/disconnected NIP-07 extension doesn't look like a silent hang —
   * the previous code awaited `getPublicKey()` with no try/catch, leaving the
   * user staring at the modal with no feedback when nos2x/Alby weren't there.
   * @type {string | null}
   */
  let extensionError = $state(null);

  // NIP-07 extensions barely exist on mobile browsers, so the card would be
  // a dead button for most phone users. The modal mounts on demand (see
  // ModalManager's {#if}), long after extensions inject window.nostr — so a
  // one-shot check at init is reliable. Desktop always shows the card:
  // clicking without an extension surfaces the inline install hint instead.
  const isMobileUA = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  const showExtensionCard = !isMobileUA || !!(/** @type {any} */ (window).nostr);

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
        extensionError = null;
        try {
          /** @type {any} */ (signer).signer = new ExtensionSigner();
          // Chrome MV3 service workers (nos2x, Alby) go dormant after ~30s.
          // The first call after dormancy commonly fails with
          // "Could not establish connection. Receiving end does not exist."
          // because the message port closes before the SW finishes waking.
          // A single retry after a short delay reliably wakes the worker.
          // `window.nostr` itself is present (we just got a stale port), so
          // ExtensionMissingError on retry is treated as truly missing.
          let pk;
          try {
            pk = await /** @type {any} */ (signer).signer.getPublicKey();
          } catch (firstErr) {
            const fmsg = /** @type {Error} */ (firstErr)?.message || '';
            const isPortClosed =
              /could not establish connection|receiving end does not exist|message port closed/i.test(
                fmsg
              );
            if (!isPortClosed) throw firstErr;
            console.warn('Extension first call failed (port closed), retrying once…');
            await new Promise((r) => setTimeout(r, 250));
            // Re-instantiate; some signers cache state from the failed call.
            /** @type {any} */ (signer).signer = new ExtensionSigner();
            pk = await /** @type {any} */ (signer).signer.getPublicKey();
          }

          // applesauce's setActive looks up by account.id (a fresh nanoid per
          // instance), so on the duplicate path we must activate the EXISTING
          // account reference rather than the freshly-built one.
          const existing = manager.getAccountForPubkey(pk);
          if (existing) {
            manager.setActive(existing);
          } else {
            const account = new ExtensionAccount(pk, /** @type {any} */ (signer).signer);
            manager.addAccount(account);
            manager.setActive(account);
          }

          modalStore.closeModal();
        } catch (err) {
          // Surface user-visible feedback instead of a silent hang. Distinguish
          // "no extension installed" (missing window.nostr) from "extension is
          // there but couldn't talk to it" so the message points at the right
          // remedy.
          const message = /** @type {Error} */ (err)?.message || '';
          const isMissing =
            /** @type {Error} */ (err)?.name === 'ExtensionMissingError' ||
            /missing|not.*found|undefined/i.test(message);
          extensionError = isMissing
            ? m.auth_login_modal_extension_error_missing()
            : m.auth_login_modal_extension_error_generic();
          console.warn('Extension login failed:', err);
        }
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
      case 'Npub':
        if (onNpubTransition) {
          onNpubTransition();
        }
        return null;
      default:
        throw new Error('Unknown signer');
    }
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box">
    <form method="dialog">
      <button
        data-testid="login-modal-close"
        class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm"
        aria-label={m.common_close()}
      >
        <CloseIcon class_="w-4 h-4" />
      </button>
    </form>

    <h1 class="text-lg font-bold">{m.auth_login_modal_add_account()}</h1>

    <div class="mt-4 space-y-4">
      {#if getAccounts().length > 0}
        <div>
          <h2 class="mb-2 text-sm font-semibold opacity-70">
            {m.auth_login_modal_available_accounts()}
          </h2>
          <ul class="space-y-2">
            {#each getAccounts() as account (account.id)}
              <AccountProfile {account} />
            {/each}
          </ul>
        </div>
        <div class="divider">{m.auth_login_modal_or()}</div>
      {/if}

      <button
        data-testid="signup-primary-cta"
        class="btn w-full btn-lg btn-primary"
        onclick={() => modalStore.openModal('signup')}
      >
        {m.auth_login_modal_create_account_cta()}
      </button>

      {#if runtimeConfig.googleLogin?.enabled}
        <button
          data-testid="login-method-google"
          class="btn w-full"
          onclick={() => onGoogleTransition?.()}
        >
          <GoogleIcon />
          {m.auth_login_modal_google()}
        </button>
      {/if}

      <div class="divider text-xs opacity-70">{m.auth_login_modal_existing_account()}</div>

      <section data-testid="other-signin-methods" class="space-y-2">
        {#if extensionError}
          <div data-testid="extension-error" class="mb-2 alert alert-error" role="alert">
            <span class="text-sm">{extensionError}</span>
          </div>
        {/if}
        <div class="grid gap-2 {showExtensionCard ? 'grid-cols-3' : 'grid-cols-2'}">
          {#if showExtensionCard}
            <button
              data-testid="login-method-extension"
              title={m.auth_login_modal_extension()}
              onclick={() => createSigner('Extension')}
              class="btn h-auto flex-col gap-2 py-4 font-normal"
            >
              <PuzzleIcon class_="h-6 w-6" title="" />
              <span class="text-xs leading-tight">{m.auth_login_modal_extension_short()}</span>
            </button>
          {/if}
          <button
            data-testid="login-method-bunker"
            title={m.auth_login_modal_bunker()}
            onclick={() => createSigner('Bunker')}
            class="btn h-auto flex-col gap-2 py-4 font-normal"
          >
            <SmartphoneIcon class_="h-6 w-6" title="" />
            <span class="text-xs leading-tight">{m.auth_login_modal_bunker_short()}</span>
          </button>
          <button
            data-testid="login-method-nsec"
            title={m.auth_login_modal_nsec()}
            onclick={() => createSigner('NSEC')}
            class="btn h-auto flex-col gap-2 py-4 font-normal"
          >
            <KeyIcon class_="h-6 w-6" title="" />
            <span class="text-xs leading-tight">{m.auth_login_modal_nsec_short()}</span>
          </button>
        </div>
        {#if runtimeConfig.npubLogin?.enabled}
          <button
            data-testid="login-method-npub"
            title={m.auth_login_modal_npub()}
            onclick={() => createSigner('Npub')}
            class="btn w-full font-normal opacity-70 btn-ghost btn-sm"
          >
            {m.auth_login_modal_npub_short()}
          </button>
        {/if}
      </section>
    </div>
  </div>
</dialog>
