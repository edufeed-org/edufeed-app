// Which Concord channel is on screen right now. Component-local
// selectedChannelId (PrivateChannelsView) can't be read by the notifications
// service, so the view mirrors it here. "Being viewed" additionally requires
// document.visibilityState === 'visible' — that check lives with the callers
// (notifications.svelte.js), not here, so this module stays trivially pure.
// No package imports — SSR-safe for any chrome component chain.

let active = $state.raw(/** @type {{communityId: string, channelId: string} | null} */ (null));

/** @param {string} communityId @param {string} channelId */
export function setActiveConcordChannel(communityId, channelId) {
  active = { communityId, channelId };
}

export function clearActiveConcordChannel() {
  active = null;
}

/** @returns {{communityId: string, channelId: string} | null} */
export function getActiveConcordChannel() {
  return active;
}
