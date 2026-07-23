// Pure helpers for ChannelInviteSheet.svelte, kept free of Svelte/rxjs/
// applesauce imports so they are trivially unit-testable (same convention as
// chat-helpers.js).

/**
 * @typedef {{ channels?: string[], revoked: boolean, createdAt: number, [k: string]: any }} ConcordInviteLinkLike
 */

/**
 * Pick the newest live (non-revoked) invite link that grants access to a
 * channel. `createdAt` is unix SECONDS per the CORD-05 Invite List wire field
 * (see applesauce-concord's ConcordInviteLink type) — comparison direction is
 * unaffected by the unit, so this works whether the caller passes seconds or
 * ms as long as it's consistent across entries.
 * @param {ConcordInviteLinkLike[] | undefined} links
 * @param {string} channelId
 * @returns {ConcordInviteLinkLike | undefined}
 */
export function pickLatestChannelInvite(links, channelId) {
  return (links ?? [])
    .filter((link) => !link.revoked && link.channels?.includes(channelId))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

// Module-level in-flight guard, keyed by `${communityId}:${channelId}`.
//
// PrivateChannelsView mounts once per responsive layout variant — the
// community route's `+layout.svelte` renders `{@render children()}` 2-3×
// simultaneously (desktop / mobile-logged-in / mobile-anon, CSS-hiding the
// inactive ones — see the community-layout-double-mount project note) — so
// nothing guarantees only one ChannelInviteSheet instance is ever alive for a
// given channel. Two instances that both find no existing live link and race
// to mint one would otherwise each publish a redundant invite bundle. Keying
// the promise here (module scope, not component state) means every caller
// racing for the same channel shares the single in-flight create and resolves
// to the same invite — regardless of which component instance kicked it off.
/** @type {Map<string, Promise<any>>} */
const inFlightCreates = new Map();

/**
 * Create a channel invite link, deduping concurrent callers for the same
 * community+channel onto a single in-flight promise.
 * @param {{ communityId: string, createInvite: (options: any) => Promise<any> }} community
 * @param {string} channelId
 * @param {any} options
 * @returns {Promise<any>}
 */
export function createChannelInviteOnce(community, channelId, options) {
  const key = `${community.communityId}:${channelId}`;
  const existing = inFlightCreates.get(key);
  if (existing) return existing;
  const promise = community.createInvite(options).finally(() => {
    // Only clear our own entry — a slow settle must not delete a fresher
    // in-flight promise a later caller already installed for the same key.
    if (inFlightCreates.get(key) === promise) inFlightCreates.delete(key);
  });
  inFlightCreates.set(key, promise);
  return promise;
}
