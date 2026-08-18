// src/lib/stores/community-access.svelte.js
//
// ONE access checker for community sections, behind the exact
// ProfileListAccess interface every existing consumer already speaks
// (layout context 'profileAccess'). Backend chosen per call from the
// community type (docs/nips/communikey-groups.md):
//   moderated → NIP-29 root-group roster + access tiers
//   open / legacy-gated → the kind-30000 profile-list hook, unchanged
// Both wrapped hooks no-op internally when their trigger tags are absent,
// so instantiating both costs nothing.
// MUST be called during component init (both wrapped hooks use $effect).
import { manager } from '$lib/stores/accounts.svelte';
import { useProfileListAccess } from './profile-list-access.svelte.js';
import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
import { deriveCommunityType } from '$lib/groups/community-membership.js';
import { parseCommunityContentTypes, sectionIsGated } from '$lib/helpers/communityRelays.js';
import { sectionAllowedAuthors, canPublishSection } from '$lib/groups/roster-access.js';

/**
 * @param {() => any} getCommunityEvent - Getter for the kind 10222 event
 * @param {() => string[]} getRelays - Relays for legacy profile-list loading
 * @returns {import('./profile-list-access.svelte.js').ProfileListAccess}
 */
export function useCommunityAccess(getCommunityEvent, getRelays) {
  const legacy = useProfileListAccess(getCommunityEvent, getRelays);
  const getRoster = useRootRoster(getCommunityEvent);

  const isModerated = () => deriveCommunityType(getCommunityEvent()) === 'moderated';
  /** @param {string} sectionName */
  const sectionByName = (sectionName) =>
    parseCommunityContentTypes(getCommunityEvent()).find((s) => s.name === sectionName) ?? null;

  return {
    get isLoading() {
      return isModerated() ? getRoster().isLoading : legacy.isLoading;
    },
    canPublish(sectionName) {
      if (!isModerated()) return legacy.canPublish(sectionName);
      return canPublishSection(sectionByName(sectionName), {
        pubkey: manager.active?.pubkey,
        ownerPubkey: getCommunityEvent()?.pubkey,
        roster: getRoster()
      });
    },
    getMembers(sectionName) {
      if (!isModerated()) return legacy.getMembers(sectionName);
      const section = sectionByName(sectionName);
      if (!sectionIsGated(section)) return [];
      return [...getRoster().members];
    },
    getAllowedAuthors(sectionName) {
      if (!isModerated()) return legacy.getAllowedAuthors(sectionName);
      return sectionAllowedAuthors(
        sectionByName(sectionName),
        getRoster(),
        getCommunityEvent()?.pubkey
      );
    },
    getFormRef(sectionName) {
      // Moderated communities have no form-based join anymore — the
      // application-form layer was removed as YAGNI (laoc, 2026-08-18);
      // joining is invite-code only, so form CTAs (hero "Anfrage stellen",
      // HomeView's gate banner) must not render for them. Legacy gated
      // sections keep their read-side form refs.
      if (isModerated()) return null;
      return legacy.getFormRef(sectionName);
    }
  };
}
