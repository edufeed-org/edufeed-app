// src/lib/helpers/community-signer.js
//
// ONE definition of "may act as this community": the signed-in manager holds
// the community's key. Communities run from a separate keypair (owner logged
// in with their personal account, community key also imported) count as
// owned — the old `activeUser.pubkey === communityPubkey` checks did not
// (handoff issue #12). Call inside $derived.by for whatever reactivity that
// buys you — but NOT as a guarantee that a mid-session account change (e.g.
// switching the active account, or importing/removing one) re-triggers
// callers: AccountManager.active is a getter over the manager's own
// internal state, not a plain property, so $state()'s proxy on `manager`
// can't observe writes reaching it that way. Treat any live-update behavior
// here as incidental, not relied-upon.
import { manager } from '$lib/stores/accounts.svelte';

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {any | null} the community account's signer, or null
 */
export function getCommunitySigner(communityPubkey) {
  if (!communityPubkey) return null;
  return manager.getAccountForPubkey(communityPubkey)?.signer ?? null;
}

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {boolean}
 */
export function isCommunityOwner(communityPubkey) {
  return getCommunitySigner(communityPubkey) !== null;
}
