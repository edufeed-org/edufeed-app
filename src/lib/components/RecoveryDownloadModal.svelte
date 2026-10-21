<script>
  // Recovery file download dialog around the shared RecoveryDownloadForm.
  //
  // Opened from the Termi assistant's backup hint, the account menu and the
  // Settings page. After a successful download we set
  // `backup-downloaded:<pubkey>` so the hint stops nagging on subsequent
  // reloads and the logout guard knows the key is safe.
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { markBackupDownloaded } from '$lib/stores/backup-flags.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import RecoveryDownloadForm from './shared/RecoveryDownloadForm.svelte';

  let { modalId } = $props();

  const getActiveUser = useActiveUser();
  // The account's name goes into the file name and header so two backups
  // never look alike (issue ddce9cc0).
  const getProfile = useUserProfile(() => getActiveUser()?.pubkey);

  // signer.key holds the raw private key bytes for nsec accounts.
  const privateKey = $derived(getActiveUser()?.signer?.key ?? null);
  const nsec = $derived(privateKey ? nip19.nsecEncode(privateKey) : '');
  const npub = $derived.by(() => {
    const pubkey = getActiveUser()?.pubkey;
    return pubkey ? nip19.npubEncode(pubkey) : '';
  });
  const label = $derived.by(() => {
    const profile = getProfile();
    return profile?.display_name || profile?.name || '';
  });

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

  function handleDownloaded() {
    const user = getActiveUser();
    if (user) markBackupDownloaded(user.pubkey);
    modalStore.closeModal();
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-md">
    <h3 class="mb-2 text-lg font-bold">{m.auth_recovery_modal_title()}</h3>
    <p class="mb-4 text-sm opacity-80">{m.auth_recovery_modal_intro()}</p>

    {#if privateKey}
      <RecoveryDownloadForm
        {privateKey}
        {nsec}
        {label}
        {npub}
        appName={runtimeConfig.appName || 'Edufeed'}
        onDownloaded={handleDownloaded}
      />
    {:else}
      <div class="alert alert-error"><span>No active key-holding account.</span></div>
    {/if}

    <div class="modal-action">
      <form method="dialog">
        <button class="btn btn-ghost">{m.common_cancel()}</button>
      </form>
    </div>
  </div>
</dialog>
