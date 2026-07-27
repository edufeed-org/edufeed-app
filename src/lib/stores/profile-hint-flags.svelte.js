// Per-pubkey dismiss flag for the Termi assistant's profile hint. Mirrors
// nip05-hint-flags: the flag lives in localStorage so a dismiss survives
// reloads, but a reactive version counter ensures markProfileHintDismissed()
// re-runs $derived consumers in the same tab (so the hint hides immediately,
// no reload needed).

const DISMISS_PREFIX = 'profile-hint-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isProfileHintDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markProfileHintDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
