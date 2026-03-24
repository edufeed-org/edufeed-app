import { EventFactory } from 'applesauce-core/event-factory';
import 'applesauce-common/blueprints';
import { publishEventOptimistic } from '$lib/services/publish-service.js';

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

  const factory = new EventFactory({ signer });

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
  publishEventOptimistic(signedEvent, communityPubkeys);

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
