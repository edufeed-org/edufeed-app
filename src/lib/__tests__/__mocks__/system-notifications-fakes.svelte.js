// Reactive stand-ins for the DM and inbox services, driven by the
// system-notifications tests. The real services expose $state-backed getters;
// the toast service reacts to them inside $effect, so the fakes must be
// reactive too (a plain closure would never re-run the effect).
let known = $state.raw(/** @type {any[]} */ ([]));
let notifications = $state.raw(/** @type {any[]} */ ([]));
/** Event ids the inbox treats as unread. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- test fixture, only read inside untrack()ed handlers
export const unread = new Set();
/** Conversation ids the DM service treats as unread. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- test fixture, only read inside untrack()ed handlers
export const dmUnread = new Set();

export function getKnownDmConversations() {
  return known;
}
/** @param {any[]} value */
export function setKnown(value) {
  known = value;
}
/** @param {string} id */
export function isDmConversationUnread(id) {
  return dmUnread.has(id);
}

export function getNotifications() {
  return notifications;
}
/** @param {any[]} value */
export function setNotifications(value) {
  notifications = value;
}
/** @param {{id: string}} event */
export function isNotificationUnread(event) {
  return unread.has(event.id);
}

export function reset() {
  known = [];
  notifications = [];
  unread.clear();
  dmUnread.clear();
}
