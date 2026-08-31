// src/lib/groups/roster-access.js
//
// Publish gating against the root-group roster, per the communikey-groups
// NIP draft: `access` tiers are WRITE gating evaluated against the CURRENT
// roster (moderation is retroactive by design — removing a member removes
// their content from the community view). The owner is always allowed:
// the community keypair moderates its own surface.
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

/**
 * @typedef {import('./root-roster.js').RosterView} RosterView
 * @typedef {{tier: 'all'}|{tier: 'members'}|{tier: 'role', role: string}} AccessTier
 */

/**
 * Allowed author pubkeys for a section, or null when the section is open.
 * @param {{access?: AccessTier} | null | undefined} section
 * @param {RosterView} roster
 * @param {string} ownerPubkey
 * @returns {string[] | null}
 */
export function sectionAllowedAuthors(section, roster, ownerPubkey) {
  const access = section?.access;
  if (!access || access.tier === 'all') return null;
  const allowed = new Set(ownerPubkey ? [ownerPubkey] : []);
  if (access.tier === 'members') {
    for (const pubkey of roster.members) allowed.add(pubkey);
  } else {
    for (const admin of roster.admins) {
      if (admin.roles?.includes(access.role)) allowed.add(admin.pubkey);
    }
  }
  return [...allowed];
}

/**
 * Callback-friendly access view over a community's sections + one roster —
 * the non-reactive counterpart of useCommunityAccess for dynamic lists
 * (dashboard) where rune hooks cannot be instantiated per community.
 * @param {any} communityEvent
 * @param {import('./root-roster.js').RosterView} roster
 * @returns {{isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null}}
 */
export function buildRosterAccess(communityEvent, roster) {
  const sections = parseCommunityContentTypes(communityEvent);
  return {
    isLoading: roster.isLoading,
    getAllowedAuthors: (name) =>
      sectionAllowedAuthors(
        sections.find((section) => section.name === name) ?? null,
        roster,
        communityEvent?.pubkey
      )
  };
}

/**
 * Whether `pubkey` may publish this section's content types to the community.
 * Conservative while the roster loads: only the owner passes.
 * @param {{access?: AccessTier} | null | undefined} section
 * @param {{pubkey?: string, ownerPubkey: string, roster: RosterView}} ctx
 * @returns {boolean}
 */
export function canPublishSection(section, { pubkey, ownerPubkey, roster }) {
  if (!pubkey) return false;
  if (pubkey === ownerPubkey) return true;
  const allowed = sectionAllowedAuthors(section, roster, ownerPubkey);
  if (allowed === null) return true;
  if (roster.isLoading) return false;
  return allowed.includes(pubkey);
}
