/**
 * Wiki Actions Store
 * Actions for creating and managing wiki articles (NIP-54, kind 30818)
 */

import { EventFactory } from 'applesauce-core/event-factory';
import { normalizeIdentifier } from 'nostr-tools/nip54';
import { manager } from '$lib/stores/accounts.svelte';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';

/** Kind number for NIP-54 wiki articles */
const WIKI_KIND = 30818;

/**
 * @typedef {Object} WikiFormData
 * @property {string} title - Wiki article title
 * @property {string} content - Markdown content
 * @property {string} topic - Topic identifier (will be normalized for d-tag)
 * @property {string} [summary] - Optional summary
 * @property {string[]} [hashtags] - Optional hashtags
 */

/**
 * Build NIP-54 tags from form data
 * @param {WikiFormData} formData
 * @param {string} dTag - Normalized topic identifier for d-tag
 * @param {string} [communityPubkey] - Optional community targeting
 * @returns {string[][]}
 */
function buildWikiTags(formData, dTag, communityPubkey) {
  const tags = [
    ['d', dTag],
    ['title', formData.title]
  ];

  if (formData.summary?.trim()) {
    tags.push(['summary', formData.summary.trim()]);
  }

  if (formData.hashtags) {
    for (const tag of formData.hashtags) {
      if (tag.trim()) {
        tags.push(['t', tag.trim().toLowerCase()]);
      }
    }
  }

  if (communityPubkey) {
    tags.push(['h', communityPubkey]);
  }

  return tags;
}

/**
 * Create a new wiki article (kind 30818)
 * @param {WikiFormData} formData
 * @param {string} [communityPubkey] - Optional community to target
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function createWiki(formData, communityPubkey, communityEvent = null) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to create wiki articles.');
  }

  if (!formData.title?.trim()) {
    throw new Error('Title is required');
  }
  if (!formData.content?.trim()) {
    throw new Error('Wiki content is required');
  }
  if (!formData.topic?.trim()) {
    throw new Error('Topic is required');
  }

  const dTag = normalizeIdentifier(formData.topic.trim());
  const tags = buildWikiTags(formData, dTag, communityPubkey);

  const eventFactory = new EventFactory();
  const eventTemplate = await eventFactory.build({
    kind: WIKI_KIND,
    content: formData.content,
    tags
  });

  const wikiEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(wikiEvent, [], { communityEvent });

  const naddr = encodeEventToNaddr(wikiEvent, getAppRelaysForCategory('communikey'));

  return { event: wikiEvent, naddr };
}

/**
 * Update an existing wiki article (kind 30818)
 * @param {WikiFormData} formData
 * @param {import('nostr-tools').NostrEvent} existingEvent - Existing wiki to update
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function updateWiki(formData, existingEvent, communityEvent = null) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to update wiki articles.');
  }

  if (existingEvent.pubkey !== currentAccount.pubkey) {
    throw new Error('Cannot update wiki: you do not own this article.');
  }

  const dTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (!dTag) {
    throw new Error('Cannot update wiki: missing d-tag.');
  }

  if (!formData.title?.trim()) {
    throw new Error('Title is required');
  }
  if (!formData.content?.trim()) {
    throw new Error('Wiki content is required');
  }

  // Preserve h-tag if present
  const hTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];

  const tags = buildWikiTags(formData, dTag, hTag || undefined);

  const eventFactory = new EventFactory();
  const eventTemplate = await eventFactory.build({
    kind: WIKI_KIND,
    content: formData.content,
    tags
  });

  const updatedEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(updatedEvent, [], { communityEvent });

  const naddr = encodeEventToNaddr(updatedEvent, getAppRelaysForCategory('communikey'));

  return { event: updatedEvent, naddr };
}
