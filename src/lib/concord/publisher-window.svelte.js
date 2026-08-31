// Publisher window (Schaufenster) — reactive state + actions.
// Spec: docs/nips/communikey-groups.md "Publisher window"; pure logic in
// publisher-window.js. Consent is load-bearing: the public list only ever
// contains members whose own kind-3320 acceptance is present in the area's
// guestbook. Call hooks during component init (they use $effect via
// useObservable/useConcordCommunity).
import { useConcordCommunity } from './community.svelte.js';
import { useObservable } from './bridge.svelte.js';
import {
  PUBLISHER_CONSENT_KIND,
  PUBLISHER_ROLE_NAME,
  PUBLISHERS_LIST_D,
  buildPublisherConsentTemplate,
  foldPublisherConsents,
  publisherRoleId,
  grantedPublishers,
  resolvePublisherListing,
  parsePublishersList,
  buildPublishersListTemplate,
  withWindowSections
} from './publisher-window.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
import { communityUpdateTemplate } from '$lib/groups/community-flips.js';
import { getCommunikeyRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

/**
 * Reactive publisher-window state for one community.
 * @param {() => any} getCommunikeyEvent kind 10222 getter
 */
export function usePublisherWindow(getCommunikeyEvent) {
  const getConcord = useConcordCommunity(getCommunikeyEvent);
  const getActiveUser = useActiveUser();

  const getRoles = useObservable(() => getConcord().community?.roles$, /** @type {any[]} */ ([]));
  const getGrants = useObservable(
    () => getConcord().community?.grants$,
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- initial value only, useObservable wraps it in $state.raw()
    /** @type {Map<string, string[]>} */ (new Map())
  );
  const getConsentRumors = useObservable(
    () => getConcord().community?.guestbookStore?.timeline?.([{ kinds: [PUBLISHER_CONSENT_KIND] }]),
    /** @type {any[]} */ ([])
  );

  // The community's public publishers list (kind 30000, d=publishers) — a
  // plain replaceable, loaded like any other and read from the EventStore.
  let listLoaderStarted = false;
  $effect(() => {
    const communityPubkey = getCommunikeyEvent()?.pubkey;
    if (!communityPubkey || listLoaderStarted) return;
    listLoaderStarted = true;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- dedup scratch, never rendered
    const relays = [...new Set([...getCommunikeyRelays(), ...getAllLookupRelays()])];
    const sub = addressLoader({
      kind: 30000,
      pubkey: communityPubkey,
      identifier: PUBLISHERS_LIST_D,
      relays
    }).subscribe();
    return () => sub.unsubscribe();
  });
  const getListEvent = useObservable(() => {
    const communityPubkey = getCommunikeyEvent()?.pubkey;
    return communityPubkey
      ? eventStore.replaceable(30000, communityPubkey, PUBLISHERS_LIST_D)
      : undefined;
  }, /** @type {any} */ (undefined));

  return () => {
    const roles = getRoles();
    const roleId = publisherRoleId(roles);
    const granted = grantedPublishers(getGrants(), roleId);
    const consents = foldPublisherConsents(getConsentRumors());
    const shouldList = resolvePublisherListing({ granted, consents });
    const listEvent = getListEvent();
    const currentList = parsePublishersList(listEvent);
    const me = getActiveUser()?.pubkey;
    /** @type {'none'|'offered'|'accepted'|'listed'|'declined'} */
    let myState = 'none';
    if (me && granted.has(me)) {
      if (currentList.includes(me)) myState = 'listed';
      else if (consents.get(me) === 'accepted') myState = 'accepted';
      else if (consents.get(me) === 'revoked') myState = 'declined';
      else myState = 'offered';
    }
    return {
      community: getConcord().community,
      roleId,
      granted,
      consents,
      shouldList,
      currentList,
      listEvent,
      // The owner's sync button appears when the consented set differs from
      // the published list.
      dirty:
        shouldList.length !== currentList.length ||
        shouldList.some((pubkey) => !currentList.includes(pubkey)),
      myState
    };
  };
}

/**
 * Member action: publish the consent rumor into the area's guestbook.
 * @param {any} community ConcordCommunity engine
 * @param {'accepted' | 'revoked'} status
 */
export async function sendPublisherConsent(community, status) {
  await community.publishToPlane({ plane: 'guestbook' }, buildPublisherConsentTemplate(status), {});
}

/**
 * A member's current role ids from either grants shape (Map or array).
 * @param {Map<string, string[]> | Array<{member?: string, role_ids?: string[]}>} grants
 * @param {string} pubkey
 * @returns {string[]}
 */
function currentRoleIds(grants, pubkey) {
  if (grants instanceof Map) return grants.get(pubkey) ?? [];
  return (grants ?? []).find((grant) => grant?.member === pubkey)?.role_ids ?? [];
}

/**
 * Owner action: offer the Publisher role to a member (creates the role on
 * first use — zero permissions, it is a marker, not an authority tier).
 * @param {any} community ConcordCommunity engine
 * @param {any[]} roles current roles
 * @param {Map<string, string[]> | any[]} grants current grants
 * @param {string} pubkey member to offer
 */
export async function offerPublisherRole(community, roles, grants, pubkey) {
  let roleId = publisherRoleId(roles);
  if (!roleId) {
    roleId = await community.createRole(PUBLISHER_ROLE_NAME, 100, 0n);
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- dedup scratch, never rendered
  const roleIds = [...new Set([...currentRoleIds(grants, pubkey), roleId])];
  await community.grantRoles(pubkey, roleIds);
}

/**
 * Owner action: revoke the Publisher role.
 * @param {any} community
 * @param {any[]} roles
 * @param {Map<string, string[]> | any[]} grants
 * @param {string} pubkey
 */
export async function revokePublisherRole(community, roles, grants, pubkey) {
  const roleId = publisherRoleId(roles);
  if (!roleId) return;
  const roleIds = currentRoleIds(grants, pubkey).filter((id) => id !== roleId);
  await community.grantRoles(pubkey, roleIds);
}

/**
 * Owner action: publish the public list to match the consented set.
 * Community-signed — caller passes the community signer (key-holding owner).
 * Deliberately does NOT touch the community's sections: which sections form
 * the window is the owner's separate choice (saveWindowSections below) —
 * auto-gating on sync would lock regular members out of an open community's
 * sections the moment a publisher list exists.
 * @param {{
 *   communikeyEvent: any,
 *   communitySigner: any,
 *   shouldList: string[],
 *   listEvent: any
 * }} args
 */
export async function syncPublishersList({
  communikeyEvent,
  communitySigner,
  shouldList,
  listEvent
}) {
  const communityPubkey = communikeyEvent?.pubkey;
  if (!communityPubkey || !communitySigner) throw new Error('community signer required');

  const template = buildPublishersListTemplate(shouldList, listEvent);
  const signed = await communitySigner.signEvent({ ...template, pubkey: communityPubkey });
  const result = await publishEvent(signed, [], { additionalRelays: getCommunikeyRelays() });
  if (!result.success) throw new Error('Failed to publish publishers list to any relay');
  eventStore.add(signed);
}

/**
 * Owner action: rewrite the community's window to exactly `selectedKeys`
 * (WINDOW_CONTENT_TYPES keys) — publisher-gated public sections, replacing
 * the previous window selection and leaving every other section alone.
 * @param {{communikeyEvent: any, communitySigner: any, selectedKeys: string[]}} args
 */
export async function saveWindowSections({ communikeyEvent, communitySigner, selectedKeys }) {
  const communityPubkey = communikeyEvent?.pubkey;
  if (!communityPubkey || !communitySigner) throw new Error('community signer required');
  const relay = getCommunikeyRelays()[0];
  const tags = withWindowSections(communikeyEvent.tags ?? [], communityPubkey, relay, selectedKeys);
  await publishCommunityUpdate(communityUpdateTemplate(communikeyEvent, tags), communitySigner);
}
