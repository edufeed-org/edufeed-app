// One subscription API for "who may author this community's sections",
// regardless of community type. Same contract as
// subscribeToProfileListMembers, but onUpdate receives a ready access object.
import {
  GROUP_ADMINS_KIND,
  GROUP_MEMBERS_KIND,
  getGroupAdmins,
  getGroupMembers
} from 'applesauce-common/helpers/groups';
import { TimelineModel } from 'applesauce-core/models';
import { storeEvents } from 'applesauce-relay/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
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
  // The relay has finished speaking (EOSE or timeout) — flips isLoading false
  // WITHOUT fabricating an empty roster (see rosterView().isLoading and
  // channel-rosters.svelte.js). Same eventStore-backed shape as useRootRoster:
  // the request FEEDS the store, the roster is READ from it, so this gate and
  // the community page's own roster read agree and can't diverge.
  let fetched = false;
  const emit = () =>
    onUpdate(
      buildRosterAccess(
        communityEvent,
        rosterView(pointer, membersByKey, adminsByKey, fetched && key ? new Set([key]) : new Set())
      )
    );

  // Read the roster reactively from the eventStore — emits synchronously on
  // subscribe with whatever the store already holds (e.g. from the community
  // page's own fetch), so the dashboard gate is warm immediately.
  const readSub = eventStore
    .model(TimelineModel, { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [pointer.id] })
    .subscribe((/** @type {any[]} */ events) => {
      if (!key) return;
      /** @type {any} */ let member;
      /** @type {any} */ let admin;
      for (const ev of events) {
        if (ev?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] !== pointer.id)
          continue;
        if (ev.kind === GROUP_MEMBERS_KIND) {
          if (!member || ev.created_at > member.created_at) member = ev;
        } else if (ev.kind === GROUP_ADMINS_KIND) {
          if (!admin || ev.created_at > admin.created_at) admin = ev;
        }
      }
      membersByKey = member ? { [key]: new Set(getGroupMembers(member) ?? []) } : {};
      adminsByKey = admin ? { [key]: getGroupAdmins(admin) ?? [] } : {};
      emit();
    });

  // Feed the store. A dead/auth-walled relay must not break the dashboard feed
  // (parity with the legacy path) nor leave the gate loading forever.
  const markFetched = () => {
    fetched = true;
    emit();
  };
  let fetchSub = { unsubscribe: () => {} };
  try {
    fetchSub = pool
      .relay(pointer.relay)
      .request(
        { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#d': [pointer.id] },
        { timeout: 8000 }
      )
      .pipe(storeEvents(eventStore))
      .subscribe({ complete: markFetched, error: markFetched });
  } catch {
    // malformed relay URL — leave access in its loading state
  }
  return {
    cleanup: () => {
      readSub.unsubscribe();
      fetchSub.unsubscribe();
    },
    hasRestrictedSections
  };
}
