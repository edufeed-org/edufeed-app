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

// Per-community SELECTED channel (final review, IMPORTANT). Distinct from
// `active` above: `active` is "on screen and being viewed right now" (one
// value, cleared on unmount, drives auto-mark-read); `selections` is "which
// channel this community's rail has picked" and must be SHARED across every
// mounted PrivateChannelsView instance. The community layout mounts 2-3
// responsive instances of that component simultaneously (see
// community-layout-double-mount in project memory) — hidden instances never
// receive row clicks, so a component-local `selectedChannelId` diverges
// (stuck at the default channels[0]) and can overwrite the shared
// active-channel store back to that stale default on any channels$
// re-emission, losing unread truth for the channel actually being viewed.
// Session-only (module state) — deliberately NOT persisted to storage.
let selections = $state.raw(/** @type {Record<string, string>} */ ({}));

/** @param {string} communityId @param {string} channelId */
export function selectConcordChannel(communityId, channelId) {
  selections = { ...selections, [communityId]: channelId };
}

/** @param {string|undefined} communityId @returns {string} */
export function getSelectedConcordChannel(communityId) {
  if (!communityId) return '';
  return selections[communityId] ?? '';
}

// Reset on account switch (called from stopConcordNotifications): without
// this, account B inherits account A's per-community selections, and a
// stale entry for a shared community blocks B's own deep-link seeding in
// PrivateChannelsView (guarded by `!getSelectedConcordChannel(cid)`).
export function clearConcordSelections() {
  selections = {};
}
