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
// NOT re-run when accounts change mid-session. `manager` itself isn't even
// reactive to begin with: $state(new AccountManager()) never proxies a
// class instance (Svelte's proxy() only wraps plain-Object/Array-prototype
// values — see accounts.svelte.js's comment on `accountsMeta`). AccountManager
// does expose cheap observables for exactly this (`accounts$`/`active$`,
// real BehaviorSubjects), so accounts.svelte.js bridges them into
// `accountsMeta.version` — a plain-object-literal $state export, genuinely
// proxied — once at module init. Reading it here (no-op — the value itself
// is unused) registers this call as a dependent of that counter, so
// $derived.by callers DO recompute on switch/import/remove — see
// accounts-version-bridge.test.js (the bump) and
// community-signer-reactivity.test.svelte.js (the real $derived.by payoff,
// against the real accounts.svelte.js module, not a mock).
import { manager, accountsMeta } from '$lib/stores/accounts.svelte';

/**
 * @param {string | undefined | null} communityPubkey
 * @returns {any | null} the community account's signer, or null
 */
export function getCommunitySigner(communityPubkey) {
  void accountsMeta.version; // no-op read: registers the accountsMeta dependency
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
