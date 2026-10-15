// Per-pubkey dismiss flag for the Termi assistant's "your extension cannot
// encrypt (NIP-44)" hint. Mirrors relay-list-flags: the flag lives in
// localStorage so a dismiss survives reloads, but a reactive version counter
// makes markSignerHintDismissed() re-run $derived consumers in the same tab
// (so the hint hides immediately, no reload needed).

const DISMISS_PREFIX = 'signer-hint-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isSignerHintDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markSignerHintDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
