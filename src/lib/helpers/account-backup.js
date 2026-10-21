// src/lib/helpers/account-backup.js
//
// "Would logging this account out lose its key for good?" — the question
// every logout path asks before removing an account (issue ddce9cc0, E).
// Only local-key accounts (applesauce type `nsec`) hold a secret this app
// can lose; extension, bunker and read-only accounts keep theirs elsewhere.
// The backup flag is injected so the pure half stays free of localStorage.

/**
 * @param {{type?: string, pubkey?: string} | null | undefined} account
 * @param {(pubkey: string) => boolean} isDownloaded backup-flags isBackupDownloaded
 * @returns {boolean}
 */
export function accountNeedsBackup(account, isDownloaded) {
  if (!account || account.type !== 'nsec' || !account.pubkey) return false;
  return !isDownloaded(account.pubkey);
}

/**
 * @template {{type?: string, pubkey?: string}} T
 * @param {T[]} accounts
 * @param {(pubkey: string) => boolean} isDownloaded
 * @returns {T[]}
 */
export function unsavedAccounts(accounts, isDownloaded) {
  return (accounts ?? []).filter((account) => accountNeedsBackup(account, isDownloaded));
}
