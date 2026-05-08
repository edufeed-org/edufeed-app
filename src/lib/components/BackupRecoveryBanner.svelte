<script>
  // Non-blocking nudge shown post-login for nsec accounts (PrivateKeyAccount /
  // SimpleAccount, type === 'nsec'). Extension and remote-signer accounts
  // already have key custody handled elsewhere and don't need a recovery file.
  //
  // Two flags so a dismiss doesn't lie about backup state:
  //   backup-downloaded:<pubkey>          — user actually downloaded the file
  //   backup-banner-dismissed:<pubkey>    — user clicked "Not now"
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';

  const getActiveUser = useActiveUser();

  // Bumped to re-evaluate localStorage flags after dismiss/download.
  let flagsTrigger = $state(0);

  /** @param {string} pubkey */
  function downloadFlag(pubkey) {
    return `backup-downloaded:${pubkey}`;
  }
  /** @param {string} pubkey */
  function dismissFlag(pubkey) {
    return `backup-banner-dismissed:${pubkey}`;
  }

  const visible = $derived.by(() => {
    // Re-read on flagsTrigger bumps.
    void flagsTrigger;
    const user = getActiveUser();
    if (!user || user.type !== 'nsec') return false;
    if (typeof localStorage === 'undefined') return false;
    // Only nudge users who created their account via the in-app wizard.
    // Pre-existing accounts (paste-in nsec, returning sessions) own their
    // backup story already and shouldn't be re-pestered.
    if (!localStorage.getItem(`signed-up-here:${user.pubkey}`)) return false;
    if (localStorage.getItem(downloadFlag(user.pubkey))) return false;
    if (localStorage.getItem(dismissFlag(user.pubkey))) return false;
    return true;
  });

  function handleDismiss() {
    const user = getActiveUser();
    if (!user) return;
    localStorage.setItem(dismissFlag(user.pubkey), '1');
    flagsTrigger++;
  }

  function handleDownload() {
    modalStore.openModal('recovery-download');
  }
</script>

{#if visible}
  <div data-testid="backup-recovery-banner" class="alert alert-warning shadow-sm">
    <div class="flex-1">
      <h3 class="font-semibold">{m.auth_backup_banner_title()}</h3>
      <p class="text-sm opacity-80">{m.auth_backup_banner_body()}</p>
    </div>
    <div class="flex gap-2">
      <button
        data-testid="backup-banner-dismiss"
        class="btn btn-ghost btn-sm"
        onclick={handleDismiss}
      >
        {m.auth_backup_banner_dismiss()}
      </button>
      <button
        data-testid="backup-banner-download"
        class="btn btn-sm btn-primary"
        onclick={handleDownload}
      >
        {m.auth_backup_banner_download_cta()}
      </button>
    </div>
  </div>
{/if}
