// Per-pubkey backup-state flags shared between the Termi assistant's backup
// hint and RecoveryDownloadModal. The two pieces of state live in localStorage so they
// survive reloads, but a reactive version counter ensures any mark*() call
// re-runs $derived consumers in the same tab — the old banner used to keep a
// stale view of these flags until the page reloaded.

const DOWNLOAD_PREFIX = 'backup-downloaded:';
const DISMISS_PREFIX = 'backup-banner-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isBackupDownloaded(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DOWNLOAD_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function isBackupDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markBackupDownloaded(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DOWNLOAD_PREFIX + pubkey, '1');
  }
  version++;
}

/** @param {string} pubkey */
export function markBackupDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
