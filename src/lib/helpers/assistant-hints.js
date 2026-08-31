// Pure state logic for the Termi assistant's account hints. The reactive
// wiring (loaders, flag stores, actions) lives in
// $lib/stores/assistant-hints.svelte.js — this module holds the testable core.

import { canSign } from '$lib/helpers/signing-guard.js';

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
