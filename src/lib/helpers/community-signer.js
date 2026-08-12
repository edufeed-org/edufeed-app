// src/lib/helpers/community-signer.js
//
// ONE definition of "may act as this community": the signed-in manager holds
// the community's key. Communities run from a separate keypair (owner logged
// in with their personal account, community key also imported) count as
// owned — the old `activeUser.pubkey === communityPubkey` checks did not
// (handoff issue #12). Call inside $derived.by so manager reactivity applies.
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
