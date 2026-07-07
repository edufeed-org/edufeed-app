// Per-community dismiss flag for LegacyContentTypesBanner. Mirrors
// dm-relay-flags: localStorage so a dismiss survives reloads, plus a reactive
// version counter so $derived consumers hide the banner immediately in-tab.

const DISMISS_PREFIX = 'legacy-content-banner-dismissed:';

let version = $state(0);

/** @param {string} communityPubkey */
export function isLegacyContentBannerDismissed(communityPubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(DISMISS_PREFIX + communityPubkey);
}

/** @param {string} communityPubkey */
export function markLegacyContentBannerDismissed(communityPubkey) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DISMISS_PREFIX + communityPubkey, '1');
  }
  version++;
}
