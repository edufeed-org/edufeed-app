// src/lib/helpers/community-signer.js
//
// ONE definition of "may act as this community": the signed-in manager holds
// the community's key. Communities run from a separate keypair (owner logged
// in with their personal account, community key also imported) count as
// owned — the old `activeUser.pubkey === communityPubkey` checks did not
// (handoff issue #12). Call inside $derived.by.
//
// Manager-reactivity resolution (Plan 5 Task 11): AccountManager.active is a
// getter over the manager's own internal state, not a plain property, so
// $state()'s proxy on `manager` can't observe writes reaching it that way —
// a bare read of `manager.getAccountForPubkey(...)` inside a $derived would
// NOT re-run when accounts change mid-session. AccountManager does expose
// cheap observables for exactly this (`accounts$`/`active$`, real
// BehaviorSubjects), so accounts.svelte.js bridges them into a plain
// `manager.accountsVersion` counter (a property ON the already-$state
// `manager`, so writes to it ARE observed) once at module init. Reading it
// here (no-op — the value itself is unused) registers this call as a
// dependent of that counter, so $derived.by callers DO recompute on switch/
// import/remove — see accounts-version-bridge.test.js (the bump) and
// community-signer-reactivity.test.svelte.js (the $derived.by payoff).
import { manager } from '$lib/stores/accounts.svelte';

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {any | null} the community account's signer, or null
 */
export function getCommunitySigner(communityPubkey) {
  void manager.accountsVersion; // no-op read: registers the accountsVersion dependency
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
