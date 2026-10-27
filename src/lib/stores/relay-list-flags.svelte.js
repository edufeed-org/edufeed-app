// Per-pubkey dismiss flag for the relay-list nudge (now the Termi assistant's
// relays hint). Mirrors dm-relay-flags: the flag
// lives in localStorage so a dismiss survives reloads, but a reactive version
// counter ensures markRelayListBannerDismissed() re-runs $derived consumers in
// the same tab (so the hint hides immediately, no reload needed).

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

// Per-pubkey + per-relay dismiss flag for the "one of your relays is dead"
// hint: hiding it for nos.lol must not hide a later one for another relay.
const DEAD_RELAY_PREFIX = 'dead-relay-hint-dismissed:';

/** @param {string} url */
function deadRelayKey(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

/** @param {string} pubkey @param {string} url */
export function isDeadRelayHintDismissed(pubkey, url) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(`${DEAD_RELAY_PREFIX}${pubkey}:${deadRelayKey(url)}`);
}

/** @param {string} pubkey @param {string} url */
export function markDeadRelayHintDismissed(pubkey, url) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`${DEAD_RELAY_PREFIX}${pubkey}:${deadRelayKey(url)}`, '1');
  }
  version++;
}
