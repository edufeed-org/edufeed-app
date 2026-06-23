// Per-pubkey dismiss flag for RelayListBanner. Mirrors dm-relay-flags: the flag
// lives in localStorage so a dismiss survives reloads, but a reactive version
// counter ensures markRelayListBannerDismissed() re-runs $derived consumers in
// the same tab (so the banner hides immediately, no reload needed).

const DISMISS_PREFIX = 'relay-list-banner-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isRelayListBannerDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markRelayListBannerDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + pubkey, '1');
  }
  version++;
}
