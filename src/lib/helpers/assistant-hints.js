// Pure state logic for the Termi assistant's account hints. The reactive
// wiring (loaders, flag stores, actions) lives in
// $lib/stores/assistant-hints.svelte.js — this module holds the testable core.

import { canSign } from '$lib/helpers/signing-guard.js';
import { blossomServerKey, uniqueBlossomServers } from '$lib/helpers/blossom-server-key.js';

/**
 * @typedef {'open' | 'doing' | 'done'} HintStatus
 */

/**
 * Derive a hint's display status.
 *
 * - `applicable` — the hint's trigger condition holds (mirrors the old banner
 *   visibility rules: right account type, network check settled, not dismissed).
 * - `confirmed` — the underlying fix is verified (backup downloaded, relay
 *   list in store, DM check 'present').
 * - `running` — the primary action fired and we're awaiting confirmation.
 * - `everOpen` — the hint was shown as open/doing earlier this session; only
 *   then does a confirmation render as "done" (no retroactive praise for
 *   accounts that were already set up at login).
 *
 * @param {{applicable: boolean, confirmed: boolean, running: boolean, everOpen: boolean}} input
 * @returns {HintStatus | null} null = not rendered
 */
export function deriveHintStatus({ applicable, confirmed, running, everOpen }) {
  if (confirmed) return everOpen ? 'done' : null;
  if (running) return 'doing';
  if (applicable) return 'open';
  return null;
}

/**
 * Accumulate which hint ids have been visible (open/doing) this session.
 * Returns the previous Set unchanged (same reference) when nothing new
 * appeared, so `$state.raw` consumers don't re-render needlessly.
 *
 * @param {Set<string>} everOpen
 * @param {Record<string, HintStatus | null>} statuses
 * @returns {Set<string>}
 */
export function trackEverOpen(everOpen, statuses) {
  let next = everOpen;
  for (const [id, status] of Object.entries(statuses)) {
    if ((status === 'open' || status === 'doing') && !next.has(id)) {
      if (next === everOpen) next = new Set(everOpen);
      next.add(id);
    }
  }
  return next;
}

/**
 * Match free-text input against the canned Q&A suggestions.
 * @template {{q: string}} T
 * @param {string} input
 * @param {T[]} suggestions
 * @returns {T | null}
 */
export function matchSuggestion(input, suggestions) {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;
  return suggestions.find((s) => s.q.trim().toLowerCase() === needle) ?? null;
}

/**
 * Derive the nip05 hint's variant and state from the membership grant flow.
 * Pure so the matrix is unit-testable; the reactive store feeds it live values.
 *
 * - `grantState` — the user's application: 'none' (never applied), 'pending'
 *   (submitted, not yet in the upstream directory), 'granted' (the wished
 *   handle resolves to the user's pubkey upstream).
 * - `activated` — the granted address is on the user's kind 0 profile.
 * - `hasNip05` — the profile carries any nip05 (granted or foreign).
 * - Dismissals are separate: hiding the early apply reminder must not
 *   suppress the later "your handle is ready" notice.
 *
 * @param {{
 *   membershipEnabled: boolean,
 *   profileSettled: boolean,
 *   grantState: 'none' | 'pending' | 'granted',
 *   activated: boolean,
 *   hasNip05: boolean,
 *   applyDismissed: boolean,
 *   readyDismissed: boolean
 * }} input
 * @returns {{variant: 'apply' | 'pending' | 'ready', applicable: boolean, confirmed: boolean}}
 */
export function deriveNip05Hint({
  membershipEnabled,
  profileSettled,
  grantState,
  activated,
  hasNip05,
  applyDismissed,
  readyDismissed
}) {
  if (grantState === 'granted') {
    return {
      variant: 'ready',
      applicable: membershipEnabled && profileSettled && !activated && !readyDismissed,
      confirmed: activated
    };
  }
  return {
    variant: grantState === 'pending' ? 'pending' : 'apply',
    applicable: membershipEnabled && profileSettled && !hasNip05 && !applyDismissed,
    confirmed: hasNip05
  };
}

/**
 * Whether the "set up your profile" hint should show. Pure so the matrix is
 * unit-testable; the reactive store feeds it live values.
 *
 * @param {{
 *   user: { type?: string } | null | undefined,
 *   settled: boolean,
 *   hasProfile: boolean,
 *   dismissed: boolean,
 *   signupOpen: boolean
 * }} input
 * @returns {boolean}
 */
export function isProfileHintApplicable({ user, settled, hasProfile, dismissed, signupOpen }) {
  return canSign(user) && settled && !hasProfile && !dismissed && !signupOpen;
}

/**
 * @param {string | undefined} url
 * @param {string[]} servers
 */
function isOneOf(url, servers) {
  if (!url) return false;
  const key = blossomServerKey(url);
  return servers.some((s) => blossomServerKey(s) === key);
}

/**
 * The two Blossom hints of a closed deployment server. Pure; the store feeds
 * live values.
 *
 * - `blossomUpgrade` — the account may use the deployment's storage but its
 *   kind 10063 list sends uploads elsewhere (another server first). One click
 *   publishes a list with the deployment servers first. An eligible account
 *   WITHOUT a list already uploads to the deployment server (routing default),
 *   so it gets no card.
 * - `blossomPublic` — the account is NOT eligible yet its list still points
 *   at the deployment server first, so every upload gets rerouted. One click
 *   moves a public server first and drops the gated ones.
 *
 * No hint for an ineligible account without a list: the defaults already
 * send it to a public server. `eligibility` must be a definite answer —
 * 'unknown' shows nothing, so we never nudge over an unanswered probe.
 *
 * @param {{
 *   gated: boolean,
 *   eligibility: 'unknown' | 'eligible' | 'ineligible',
 *   user: { type?: string } | null | undefined,
 *   listSettled: boolean,
 *   userServers: string[],
 *   defaultServers: string[],
 *   upgradeDismissed: boolean,
 *   publicDismissed: boolean
 * }} input
 * @returns {{
 *   upgrade: { applicable: boolean, confirmed: boolean },
 *   public: { applicable: boolean, confirmed: boolean }
 * }}
 */
export function deriveBlossomHints({
  gated,
  eligibility,
  user,
  listSettled,
  userServers,
  defaultServers,
  upgradeDismissed,
  publicDismissed
}) {
  const firstIsDefault = isOneOf(userServers[0], defaultServers);
  const hasDefault = userServers.some((s) => isOneOf(s, defaultServers));
  const eligible = gated && eligibility === 'eligible';
  const ineligible = gated && eligibility === 'ineligible';
  const ready = canSign(user) && listSettled;
  return {
    upgrade: {
      applicable:
        eligible &&
        ready &&
        defaultServers.length > 0 &&
        userServers.length > 0 &&
        !firstIsDefault &&
        !upgradeDismissed,
      confirmed: eligible && firstIsDefault
    },
    public: {
      applicable: ineligible && ready && firstIsDefault && !publicDismissed,
      confirmed: ineligible && userServers.length > 0 && !hasDefault
    }
  };
}

/**
 * Kind 10063 list for an eligible account: deployment servers first, then
 * whatever the user had, deduped.
 * @param {string[]} userServers
 * @param {string[]} defaultServers
 * @returns {string[]}
 */
export function buildUpgradedServerList(userServers, defaultServers) {
  return uniqueBlossomServers([...defaultServers, ...userServers]);
}

/**
 * Kind 10063 list for an ineligible account: a public server first, the
 * user's other servers minus the gated deployment ones, remaining publics.
 * @param {string[]} userServers
 * @param {string[]} defaultServers
 * @param {string[]} publicServers
 * @returns {string[]}
 */
export function buildPublicServerList(userServers, defaultServers, publicServers) {
  const ownOthers = userServers.filter((s) => !isOneOf(s, defaultServers));
  return uniqueBlossomServers([publicServers[0], ...ownOthers, ...publicServers.slice(1)]);
}
