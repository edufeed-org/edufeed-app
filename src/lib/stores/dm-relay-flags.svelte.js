// Per-pubkey dismiss flag for the DM-relay nudge (now the Termi assistant's
// dm hint). Mirrors backup-flags: the flag
// lives in localStorage so a dismiss survives reloads, but a reactive version
// counter ensures markDmRelayBannerDismissed() re-runs $derived consumers in
// the same tab (so the hint hides immediately, no reload needed).

const DISMISS_PREFIX = 'dm-relay-banner-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isDmRelayBannerDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markDmRelayBannerDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
