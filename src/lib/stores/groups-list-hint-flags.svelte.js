// Per-pubkey dismiss flag for the Termi assistant's groupsList hint. Mirrors
// blossom-hint-flags: localStorage for persistence, a reactive version
// counter so a dismiss hides the card in the same tab without a reload.

const PREFIX = 'groups-list-hint-dismissed:';

let version = $state(0);

/** @param {string} pubkey */
export function isGroupsListHintDismissed(pubkey) {
  void version;
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(PREFIX + pubkey);
}

/** @param {string} pubkey */
export function markGroupsListHintDismissed(pubkey) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(PREFIX + pubkey, '1');
  version++;
}
