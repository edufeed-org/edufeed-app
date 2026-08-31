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
 *
 * For a public channel (`isPrivate = false`), there's no per-channel key to
 * grant — invites there are AREA invites (`channels: []`, see area-invite.js)
 * that admit the member to the whole community, so any live area invite can
 * be reused for any public channel.
 * @param {ConcordInviteLinkLike[] | undefined} links
 * @param {string} channelId
 * @param {boolean} [isPrivate=true] - public channels reuse the latest AREA invite (empty channels)
 * @returns {ConcordInviteLinkLike | undefined}
 */
export function pickLatestChannelInvite(links, channelId, isPrivate = true) {
  return (links ?? [])
    .filter(
      (link) =>
        !link.revoked && (isPrivate ? link.channels?.includes(channelId) : !link.channels?.length)
    )
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
 * Resolve the OUTER kind-1059 gift-wrap event for a decrypted Direct Invite.
 *
 * Why this exists: `InviteWatcher.dismiss(event)` keys its dismissal set by
 * the WRAP id (`record.wrap.id` in `recompute()`), and `resolveWrap()` returns
 * any non-string argument as-is — so passing the decrypted kind-3313 rumor
 * (whose id differs from the wrap id) adds a never-matching id and the invite
 * never leaves `invites$`/`pending$`. The `ConcordDirectInvite` cast exposes
 * only the rumor, but applesauce-common's gift-wrap helpers (gift-wrap.js in
 * the concord-pinned fork) maintain GLOBAL-REGISTRY Symbol backlinks that the
 * watcher's own `decrypt()` path populates via `getGiftWrapRumor(wrap)`:
 *   rumor —Symbol.for('seal')→ Set<seal> —Symbol.for('gift-wrap')→ wrap
 * (`addParentSealReference` sets the first, `getGiftWrapSeal` the second).
 * Because they use `Symbol.for(...)` (the cross-realm/cross-package symbol
 * registry), we can walk the chain here without importing the package — which
 * also keeps this module free of package imports (SSR-clean by construction).
 *
 * Returns undefined when the backlinks are absent (e.g. an invite object that
 * never went through a gift-wrap decode) — callers should treat that as
 * "cannot dismiss" rather than passing the rumor and silently no-opping.
 *
 * @param {{ rumor?: any } | undefined | null} invite - a ConcordDirectInvite (or anything with a `.rumor`)
 * @returns {any | undefined} the outer kind-1059 wrap event, or undefined
 */
export function resolveInviteWrap(invite) {
  const seals = invite?.rumor?.[Symbol.for('seal')];
  if (!seals) return undefined;
  for (const seal of seals) {
    const wrap = seal?.[Symbol.for('gift-wrap')];
    if (wrap?.id) return wrap;
  }
  return undefined;
}

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
