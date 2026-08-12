// One subscription API for "who may author this community's sections",
// regardless of community type. Same contract as
// subscribeToProfileListMembers, but onUpdate receives a ready access object.
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import {
  subscribeToProfileListMembers,
  buildProfileAccess
} from '$lib/helpers/profile-list-members.js';
import { parseCommunityContentTypes, sectionIsGated } from '$lib/helpers/communityRelays.js';
import { deriveCommunityType, parseMembershipPointer } from './community-membership.js';
import { channelKey } from './community-pointer.js';
import { rosterView } from './root-roster.js';
import { buildRosterAccess } from './roster-access.js';

/**
 * @param {any} communityEvent - kind 10222
 * @param {string[]} relays - legacy profile-list relays (ignored for moderated)
 * @param {(access: {isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null}) => void} onUpdate
 * @returns {{cleanup: () => void, hasRestrictedSections: boolean}}
 */
export function subscribeToCommunityAccess(communityEvent, relays, onUpdate) {
  if (deriveCommunityType(communityEvent) !== 'moderated') {
    return subscribeToProfileListMembers(communityEvent, relays, (memberMap) => {
      onUpdate(buildProfileAccess(memberMap, false));
    });
  }

  const pointer = parseMembershipPointer(communityEvent);
  const hasRestrictedSections = parseCommunityContentTypes(communityEvent).some(sectionIsGated);
  if (!pointer || !hasRestrictedSections) {
    return { cleanup: () => {}, hasRestrictedSections };
  }

  const key = channelKey(pointer);
  /** @type {Record<string, Set<string>>} */
  let membersByKey = {};
  /** @type {Record<string, import('applesauce-common/helpers/groups').GroupAdmin[]>} */
  let adminsByKey = {};
  const emit = () =>
    onUpdate(buildRosterAccess(communityEvent, rosterView(pointer, membersByKey, adminsByKey)));

  let sub = { unsubscribe: () => {} };
  try {
    sub = pool
      .relay(pointer.relay)
      .request(
        { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [pointer.id] },
        { timeout: 8000 }
      )
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (!event || !Array.isArray(event.tags) || !key) return;
          if (event.kind === GROUP_MEMBERS_KIND) {
            membersByKey = { ...membersByKey, [key]: new Set(getGroupMembers(event) ?? []) };
          } else if (event.kind === GROUP_ADMINS_KIND) {
            adminsByKey = { ...adminsByKey, [key]: getGroupAdmins(event) ?? [] };
          } else {
            return;
          }
          emit();
        },
        // A dead group relay must not break the whole dashboard feed —
        // parity with the legacy path, which also never errors the caller.
        error: () => {}
      });
  } catch {
    // malformed relay URL — leave access in its loading state
  }
  return { cleanup: () => sub.unsubscribe(), hasRestrictedSections };
}
