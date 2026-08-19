// Which NIP-29 channel a community's rail has picked — the group twin of
// active-channel.svelte.js's `selections` (see its doc comment for why this
// must be module state: the community layout mounts 2-3 responsive instances
// of PrivateChannelsView, and a component-local selection diverges across
// them). Keyed by the COMMUNIKEY PUBKEY (a group channel belongs to the
// community, not to a Concord area id), holding the channelKey
// (`wss://relay/'id`) of the picked channel.
//
// Community channels used to open the standalone /groups/<host'id> route —
// built for browsing a relay directory, and disastrous when the host is a
// big public relay: its sidebar is the ENTIRE host directory and the page
// drowns loading it (laoc, 2026-08-19: first Edufeed channel landed the
// owner "in the big 0xchat group"). Selection keeps the chat inside the
// community layout instead; /groups stays what it was built for.
//
// Session-only, deliberately not persisted. A stale selection is harmless:
// PrivateChannelsView validates it against the community's CURRENT group
// pointers before rendering anything.

let selections = $state.raw(/** @type {Record<string, string>} */ ({}));

/** @param {string} communityPubkey @param {string} channelKey */
export function selectGroupChannel(communityPubkey, channelKey) {
  selections = { ...selections, [communityPubkey]: channelKey };
}

/** @param {string|undefined|null} communityPubkey @returns {string} */
export function getSelectedGroupChannel(communityPubkey) {
  if (!communityPubkey) return '';
  return selections[communityPubkey] ?? '';
}

/** Back to the overview pane for one community.
 * @param {string|undefined|null} communityPubkey */
export function clearGroupChannelSelection(communityPubkey) {
  if (!communityPubkey || !(communityPubkey in selections)) return;
  const next = { ...selections };
  delete next[communityPubkey];
  selections = next;
}
