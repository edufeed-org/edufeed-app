/**
 * Selection rules shared by the two surfaces that show membership
 * applications to an admin: the approvals panel and the pending badge.
 *
 * Two things have to happen to the raw kind 1069 timeline before it is
 * usable:
 *
 *   1. Applications are fanned out as one encrypted copy per admin, so only
 *      the copies p-tagged to the *active* admin belong in that admin's
 *      queue — the others are undecryptable here, and counting them would
 *      count every application once per configured admin.
 *   2. Kind 1069 is a regular event, so re-submitting an application adds a
 *      copy rather than replacing the old one. Only the newest submission
 *      per applicant is actionable: approving a superseded copy provisions
 *      the handle the applicant asked for *before* they edited it.
 */

import { baseLocale, isLocale } from '$lib/paraglide/runtime.js';

/**
 * Key under which the application form stores the applicant's UI locale in
 * the encrypted answers (a `response` tag like any field, so it travels and
 * decrypts with them). Not a template field: the approvals panel renders only
 * template fields, so it never shows up as an answer.
 */
export const APPLICANT_LOCALE_FIELD = 'ui_locale';

/**
 * Language for the approval DM: the one the applicant used when applying.
 *
 * The DM is composed in the *admin's* browser, and before this field existed
 * it was rendered in the admin's UI language — a German applicant got an
 * English welcome because the admin happened to browse in English. Older
 * applications carry no locale; they fall back to the deployment's base
 * locale, never the admin's.
 *
 * @param {Record<string, string> | undefined} values - decrypted answers
 * @returns {import('$lib/paraglide/runtime.js').Locale}
 */
export function resolveApplicantLocale(values) {
  const stored = values?.[APPLICANT_LOCALE_FIELD];
  return isLocale(stored) ? stored : baseLocale;
}

/**
 * Copies of `formAddress` responses addressed to `adminPubkey`, reduced to the
 * newest submission per applicant.
 *
 * Input order is preserved for the applicants that survive, so a newest-first
 * timeline stays newest-first. Ties on `created_at` fall back to the lower
 * event id so the choice is stable across reloads rather than dependent on
 * relay arrival order.
 *
 * @param {import('nostr-tools').NostrEvent[] | undefined} events
 * @param {string} formAddress
 * @param {string} adminPubkey
 * @returns {import('nostr-tools').NostrEvent[]}
 */
export function selectAdminApplications(events, formAddress, adminPubkey) {
  if (!formAddress || !adminPubkey) return [];

  const matching = (events || []).filter(
    (e) =>
      e.tags.some((t) => t[0] === 'a' && t[1] === formAddress) &&
      e.tags.some((t) => t[0] === 'p' && t[1] === adminPubkey)
  );

  /** @type {Map<string, import('nostr-tools').NostrEvent>} */
  const latest = new Map();
  for (const event of matching) {
    const held = latest.get(event.pubkey);
    if (!held || supersedes(event, held)) latest.set(event.pubkey, event);
  }
  return [...latest.values()];
}

/**
 * @param {import('nostr-tools').NostrEvent} candidate
 * @param {import('nostr-tools').NostrEvent} held
 */
function supersedes(candidate, held) {
  if (candidate.created_at !== held.created_at) return candidate.created_at > held.created_at;
  return candidate.id < held.id;
}

/**
 * Canonical form of a wished NIP-05 handle.
 *
 * NIP-05 restricts the local part to `a-z0-9-_.`, and the nip-05-service
 * enforces exactly that (400 "name must match [a-z0-9-_.]+ pattern"). The
 * generic form renderer hands us whatever the applicant typed, so every
 * surface that stores, checks, displays or provisions the handle goes through
 * this one normaliser — "Campus" and "campus" are the same address.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHandle(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
