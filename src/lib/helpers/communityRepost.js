import { ShareFactory } from 'applesauce-common/factories';
import { finalizeDraft } from '$lib/helpers/event-factory.js';
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
 * Whether this event has been deleted by its own author (NIP-09).
 *
 * Sharing a deleted event publishes a repost nobody else can resolve: the
 * target is gone from the relays, so the content simply never appears for
 * anyone but the sharer, who is still holding a stale local copy. That is not
 * hypothetical — a resource deleted 17 days earlier was shared exactly this way
 * (laoc, 2026-08-24). The complementary half is loading other authors'
 * deletions at all (stores/author-deletions.svelte.js); this is the guard that
 * makes the answer act on something.
 *
 * `DeleteManager.check` is applesauce's own answer to this question (it checks
 * the id AND the address, and only honours the author's own deletion). The cast
 * is because the `deletes` FIELD is typed private on EventStore while the
 * method it holds is documented public — an upstream typing gap, not a reach
 * into internals. There is no alternative here: kind-5s are consumed into that
 * manager and are NOT retained in the queryable database (`getByFilters({kinds:
 * [5]})` returns nothing — measured), and `hasEvent` cannot stand in either,
 * since a deleted event is REMOVED from the store and "absent" would then also
 * mean "never loaded", refusing every share of anything not already cached.
 *
 * CAUTION for callers: `check` memoises `Symbol(replaceable-identifier)` onto
 * the event it inspects, and object spread copies own symbols — so
 * `{...checkedEvent, tags: [['d', 'other']]}` inherits the ORIGINAL's address
 * and is judged deleted. Build event copies as fresh literals.
 *
 * @param {any} event
 * @returns {boolean}
 */
export function isDeletedEvent(event) {
  if (!event) return false;
  // Never let a store quirk block a legitimate share — a share that should
  // have been refused is recoverable, one that cannot happen at all is not.
  try {
    return /** @type {any} */ (eventStore).deletes.check(event) === true;
  } catch {
    return false;
  }
}

/**
 * Create a single NIP-18 repost with multiple h-tags for community targeting.
 * Signs only ONCE regardless of how many communities are selected.
 * @param {any} event - The event to share
 * @param {string[]} communityPubkeys - Target community pubkeys (hex)
 * @param {any} signer - Account signer
 * @returns {Promise<boolean>} false when the target has been deleted — refused
 *   before signing, so no dangling repost is ever produced
 */
export async function createCommunityReposts(event, communityPubkeys, signer) {
  if (!communityPubkeys.length) return true;
  // Checked here rather than only in the dialog so every caller is covered.
  if (isDeletedEvent(event)) return false;

  const template = await finalizeDraft(ShareFactory.share(event));

  // Add h-tag for each community — single event, multiple targets
  for (const pubkey of communityPubkeys) {
    template.tags = [...template.tags, ['h', pubkey]];
  }

  // Clear content for replaceable events (NIP-18: optional when a-tag present)
  const aTag = template.tags.find((/** @type {string[]} */ t) => t[0] === 'a');
  if (aTag) {
    template.content = '';
  }

  const signedEvent = await signer.signEvent(template);

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
