import 'applesauce-common/blueprints';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import {
  getAppRelaysForCategory,
  kindToAppRelayCategory
} from '$lib/services/app-relay-service.svelte.js';
import {
  getRelaysForKind,
  getCommunityGlobalRelays,
  getCommunityRelaysByEnforcement
} from '$lib/helpers/communityRelays.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';

/**
 * Relays a community repost must reach to be discoverable: the communikey
 * app relays (community surfaces read shares from there), the app relays of
 * the SHARED kind, and each target community's own relays from its kind
 * 10222. The default publish path only covers the sharer's outbox — which
 * made shares invisible to the community (edufeed-app#21).
 *
 * @param {any} event - the event being shared
 * @param {string[]} communityPubkeys
 * @returns {string[]}
 */
function repostTargetRelays(event, communityPubkeys) {
  const relays = new Set(getAppRelaysForCategory('communikey'));

  const category = kindToAppRelayCategory(event.kind);
  if (category) {
    for (const r of getAppRelaysForCategory(category)) relays.add(r);
  }

  for (const pubkey of communityPubkeys) {
    const communityEvent = eventStore.getReplaceable(10222, pubkey);
    if (!communityEvent) continue;
    for (const r of getRelaysForKind(communityEvent, event.kind)) relays.add(r);
    for (const r of getCommunityGlobalRelays(communityEvent)) relays.add(r);
    for (const r of getCommunityRelaysByEnforcement(communityEvent).enforced) relays.add(r);
  }

  return Array.from(relays);
}

/**
 * Create a single NIP-18 repost with multiple h-tags for community targeting.
 * Signs only ONCE regardless of how many communities are selected.
 * @param {any} event - The event to share
 * @param {string[]} communityPubkeys - Target community pubkeys (hex)
 * @param {any} signer - Account signer
 * @returns {Promise<boolean>}
 */
export async function createCommunityReposts(event, communityPubkeys, signer) {
  if (!communityPubkeys.length) return true;

  const factory = createAppEventFactory({ signer });

  const template = await factory.share(event);

  // Add h-tag for each community — single event, multiple targets
  for (const pubkey of communityPubkeys) {
    template.tags = [...template.tags, ['h', pubkey]];
  }

  // Clear content for replaceable events (NIP-18: optional when a-tag present)
  const aTag = template.tags.find((t) => t[0] === 'a');
  if (aTag) {
    template.content = '';
  }

  const signedEvent = await factory.sign(template);

  // Optimistic publish: adds to EventStore immediately, publishes in background
  publishEventOptimistic(signedEvent, communityPubkeys, {
    additionalRelays: repostTargetRelays(event, communityPubkeys)
  });

  return true;
}

/**
 * Create a NIP-18 repost with h-tag for a single community.
 * Convenience wrapper around createCommunityReposts.
 * @param {any} event - The event to share
 * @param {string} communityPubkey - Target community pubkey (hex)
 * @param {any} signer - Account signer
 * @returns {Promise<boolean>}
 */
export async function createCommunityRepost(event, communityPubkey, signer) {
  return createCommunityReposts(event, [communityPubkey], signer);
}
