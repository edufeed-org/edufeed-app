// Per-pubkey dismiss flag for the Termi assistant's nip05 hint. Mirrors
// relay-list-flags: the flag lives in localStorage so a dismiss survives
// reloads, but a reactive version counter ensures markNip05HintDismissed()
// re-runs $derived consumers in the same tab (so the hint hides immediately,
// no reload needed).

const DISMISS_PREFIX = 'nip05-hint-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isNip05HintDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markNip05HintDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
