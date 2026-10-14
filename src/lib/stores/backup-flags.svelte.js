// Per-pubkey backup-state flag shared between the Termi assistant's backup
// hint, RecoveryDownloadModal, the signup wizard and the logout guard. It
// lives in localStorage so it survives reloads, but a reactive version
// counter ensures any mark*() call re-runs $derived consumers in the same
// tab — the old banner used to keep a stale view until the page reloaded.
//
// There is deliberately no persistent "dismissed" flag any more (issue
// ddce9cc0, C): a never-backed-up local key is lost with the next logout,
// so the hint must come back until the file was actually downloaded.

const DOWNLOAD_PREFIX = 'backup-downloaded:';

let version = $state(0);

/** @param {string} pubkey */
export function isBackupDownloaded(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DOWNLOAD_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markBackupDownloaded(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DOWNLOAD_PREFIX + pubkey, '1');
  }
  version++;
}
