<script>
  // Non-blocking nudge shown post-login for nsec accounts (PrivateKeyAccount /
  // SimpleAccount, type === 'nsec'). Extension and remote-signer accounts
  // already have key custody handled elsewhere and don't need a recovery file.
  //
  // Backup state (downloaded / dismissed) lives in backup-flags.svelte.js so
  // RecoveryDownloadModal's mark* calls reactively hide this banner without a
  // page reload.
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import {
    isBackupDownloaded,
    isBackupDismissed,
    markBackupDismissed
  } from '$lib/stores/backup-flags.svelte.js';
  import { LockIcon, CloseIcon } from '$lib/components/icons';

  const getActiveUser = useActiveUser();

  const visible = $derived.by(() => {
    const user = getActiveUser();
    if (!user || user.type !== 'nsec') return false;
    if (typeof localStorage === 'undefined') return false;
    // Only nudge users who created their account via the in-app wizard.
    // Pre-existing accounts (paste-in nsec, returning sessions) own their
    // backup story already and shouldn't be re-pestered.
    if (!localStorage.getItem(`signed-up-here:${user.pubkey}`)) return false;
    if (isBackupDownloaded(user.pubkey)) return false;
    if (isBackupDismissed(user.pubkey)) return false;
    return true;
  });

  function handleDismiss() {
    const user = getActiveUser();
    if (!user) return;
    markBackupDismissed(user.pubkey);
  }

  function handleDownload() {
    modalStore.openModal('recovery-download');
  }
</script>

{#if visible}
  <div
    data-testid="backup-recovery-banner"
    role="status"
    class="relative mx-auto flex w-full max-w-4xl items-center gap-3 rounded-lg border border-warning/40 bg-warning/15 p-3 pr-10 text-warning-content/90 shadow-sm sm:gap-4 sm:p-4 sm:pr-12"
  >
    <div
      class="hidden h-10 w-10 flex-none items-center justify-center rounded-full bg-warning/30 text-warning-content sm:flex"
      aria-hidden="true"
    >
      <LockIcon class_="w-5 h-5" />
    </div>
    <div class="min-w-0 flex-1">
      <h3 class="text-sm leading-tight font-semibold sm:text-base">
        {m.auth_backup_banner_title()}
      </h3>
      <p class="mt-0.5 text-xs leading-snug opacity-80 sm:text-sm">
        {m.auth_backup_banner_body()}
      </p>
    </div>
    <button
      data-testid="backup-banner-download"
      class="btn flex-none whitespace-nowrap btn-sm btn-primary"
      onclick={handleDownload}
    >
      {m.auth_backup_banner_download_cta()}
    </button>
    <button
      data-testid="backup-banner-dismiss"
      class="btn absolute top-1.5 right-1.5 btn-circle text-warning-content/70 btn-ghost btn-xs hover:text-warning-content sm:top-2 sm:right-2"
      aria-label={m.auth_backup_banner_dismiss()}
      title={m.auth_backup_banner_dismiss()}
      onclick={handleDismiss}
    >
      <CloseIcon class_="w-4 h-4" />
    </button>
  </div>
{/if}
