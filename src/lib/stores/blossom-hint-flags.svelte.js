// Per-pubkey dismiss flags for the Termi assistant's two Blossom hints
// (blossomUpgrade / blossomPublic). Mirrors nip05-hint-flags: localStorage
// for persistence, a reactive version counter so a dismiss hides the card
// in the same tab without a reload. The two flags are separate — hiding the
// "use edufeed storage" nudge must not swallow a later "your list points at
// a server that refuses you" notice, and vice versa.

const UPGRADE_PREFIX = 'blossom-upgrade-hint-dismissed:';
const PUBLIC_PREFIX = 'blossom-public-hint-dismissed:';

let version = $state(0);

/** @param {string} prefix @param {string} pubkey */
function has(prefix, pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(prefix + pubkey);
}

/** @param {string} prefix @param {string} pubkey */
function mark(prefix, pubkey) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(prefix + pubkey, '1');
  version++;
}

/** @param {string} pubkey */
export function isBlossomUpgradeHintDismissed(pubkey) {
  return has(UPGRADE_PREFIX, pubkey);
}
/** @param {string} pubkey */
export function markBlossomUpgradeHintDismissed(pubkey) {
  mark(UPGRADE_PREFIX, pubkey);
}
/** @param {string} pubkey */
export function isBlossomPublicHintDismissed(pubkey) {
  return has(PUBLIC_PREFIX, pubkey);
}
/** @param {string} pubkey */
export function markBlossomPublicHintDismissed(pubkey) {
  mark(PUBLIC_PREFIX, pubkey);
}
