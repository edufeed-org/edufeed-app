/**
 * Publication Actions Store
 * Actions for creating and managing scientific publications
 * (NKBIP-01 "Curated Publications", kind 30040 — metadata-only index events).
 */

import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { manager } from '$lib/stores/accounts.svelte';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEvent, publishEventOptimistic } from '$lib/services/publish-service.js';
import { cachePublishedEvent } from '$lib/helpers/replaceableUpdates.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
import { appendCreatorPTags } from '$lib/helpers/educational/eventTags.js';
import {
  buildPublicationTags,
  PUBLICATION_KIND
} from '$lib/helpers/publication/publicationTags.js';

/**
 * @typedef {import('$lib/helpers/publication/publicationTags.js').PublicationFormData} PublicationFormData
 */

/**
 * Build, sign and publish a new publication event.
 *
 * @param {PublicationFormData} formData
 * @param {string} [communityPubkey] - Optional community to target
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Community event for relay routing
 * @param {{ awaitPublish?: boolean, dTag?: string }} [options] - `awaitPublish` waits for the
 *   relays and rejects with `publish_failed` when none accepted (naddr hints = accepting relays);
 *   `dTag` publishes under a known address (Termi: a retry replaces the same series)
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function createPublication(
  formData,
  communityPubkey,
  communityEvent = null,
  options = {}
) {
  return publishPublication(formData, options.dTag, communityPubkey, communityEvent, options);
}

/**
 * Update an existing publication (same d-tag → replaceable overwrite).
 *
 * @param {PublicationFormData} formData
 * @param {import('nostr-tools').NostrEvent} existingEvent
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function updatePublication(formData, existingEvent) {
  const dTag = existingEvent.tags.find((t) => t[0] === 'd')?.[1];
  if (!dTag) throw new Error('Existing publication has no d tag');
  // Preserve community targeting on update
  const hTag = existingEvent.tags.find((t) => t[0] === 'h')?.[1];
  return publishPublication(formData, dTag, hTag);
}

/**
 * Shared create/update path.
 *
 * @param {PublicationFormData} formData
 * @param {string} [dTag]
 * @param {string} [communityPubkey]
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent]
 * @param {{ awaitPublish?: boolean }} [options]
 */
async function publishPublication(
  formData,
  dTag,
  communityPubkey,
  communityEvent = null,
  options = {}
) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to publish.');
  }
  if (!formData.title?.trim()) {
    throw new Error('Title is required');
  }

  const tags = buildPublicationTags(formData, dTag);
  await appendCreatorPTags(tags, formData.creators, getPrimaryWriteRelay);
  if (communityPubkey) tags.push(['h', communityPubkey]);

  const eventFactory = createAppEventFactory();
  // NKBIP-01: index events MUST have empty content
  const eventTemplate = await eventFactory.build({
    kind: PUBLICATION_KIND,
    content: '',
    tags
  });

  const publicationEvent = await currentAccount.signEvent(eventTemplate);
  if (options.awaitPublish) {
    const result = await publishEvent(publicationEvent, [], { communityEvent });
    if (!result.success) throw new Error('publish_failed');
    cachePublishedEvent(publicationEvent, result);
    return {
      event: publicationEvent,
      naddr: encodeEventToNaddr(publicationEvent, result.acceptedRelays.slice(0, 3))
    };
  }
  publishEventOptimistic(publicationEvent, [], { communityEvent });

  const naddr = encodeEventToNaddr(publicationEvent, getAppRelaysForCategory('educational'));

  return { event: publicationEvent, naddr };
}
