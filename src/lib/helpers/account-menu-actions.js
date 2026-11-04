/**
 * Account menu actions shared by the desktop profile dropdown
 * (AccountMenuSection) and the phone menu sheet (MobileMenuSheet): the own
 * QR code and the two logout flows, including the "never backed up" guard
 * (issue ddce9cc0). Every action calls `onClose` so the opening surface can
 * dismiss itself; the confirm dialog is a global modal and survives that.
 */
import { nip19 } from 'nostr-tools';
import { manager } from '$lib/stores/accounts.svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { isBackupDownloaded } from '$lib/stores/backup-flags.svelte.js';
import { accountNeedsBackup, unsavedAccounts } from '$lib/helpers/account-backup.js';

/**
 * Issue 9f7816e3: the own QR code one tap away on every page.
 * @param {string | undefined} pubkey
 * @param {() => void} onClose
 */
export function openOwnQrCode(pubkey, onClose) {
  if (!pubkey) return;
  modalStore.openModal('profileQr', { pubkey, npub: nip19.npubEncode(pubkey) });
  onClose();
}

/**
 * Ask before a logout that would lose a never-backed-up key.
 * @param {{mode: 'current' | 'all', count: number, canDownload: boolean}} props
 * @param {() => void} remove
 * @param {() => void} onClose
 */
function confirmLogout(props, remove, onClose) {
  modalStore.openModal('logoutConfirm', props, {
    onConfirm: () => {
      remove();
      modalStore.closeModal();
    },
    onCancel: () => modalStore.closeModal(),
    onBackup: () => modalStore.openModal('recovery-download')
  });
  onClose();
}

/**
 * Log out the given (active) account; a local key that was never downloaded
 * goes through the confirm dialog first.
 * @param {any} account
 * @param {() => void} onClose
 */
export function logoutCurrent(account, onClose) {
  if (!account) {
    onClose();
    return;
  }
  if (accountNeedsBackup(account, isBackupDownloaded)) {
    confirmLogout(
      { mode: 'current', count: 1, canDownload: true },
      () => manager.removeAccount(account.id),
      onClose
    );
    return;
  }
  manager.removeAccount(account.id);
  onClose();
}

/**
 * Log out every account, always through the confirm dialog, counting the
 * local keys that were never downloaded.
 * @param {string | undefined} activePubkey
 * @param {() => void} onClose
 */
export function logoutAll(activePubkey, onClose) {
  const accounts = [...manager.accounts];
  const unsaved = unsavedAccounts(accounts, isBackupDownloaded);
  confirmLogout(
    {
      mode: 'all',
      count: unsaved.length,
      canDownload: unsaved.some((a) => a.pubkey === activePubkey)
    },
    () => accounts.forEach((account) => manager.removeAccount(account.id)),
    onClose
  );
}
