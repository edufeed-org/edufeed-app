/**
 * Article Actions Store
 * Actions for creating and managing long-form articles (NIP-23, kind 30023)
 */

import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { manager } from '$lib/stores/accounts.svelte';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';

/** Kind number for NIP-23 long-form articles */
const ARTICLE_KIND = 30023;

/**
 * @typedef {Object} ArticleFormData
 * @property {string} title - Article title
 * @property {string} content - Markdown content
 * @property {string} [summary] - Optional summary
 * @property {string} [image] - Optional cover image URL
 * @property {string[]} [hashtags] - Optional hashtags
 */

/**
 * Generate a random 8-character identifier
 * @returns {string}
 */
function generateRandomId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Build NIP-23 tags from form data
 * @param {ArticleFormData} formData
 * @param {string} [dTag] - Optional d-tag (for updates)
 * @param {string} [communityPubkey] - Optional community targeting
 * @returns {string[][]}
 */
function buildArticleTags(formData, dTag, communityPubkey) {
  const tags = [
    ['d', dTag || generateRandomId()],
    ['title', formData.title]
  ];

  // published_at in seconds
  tags.push(['published_at', String(Math.floor(Date.now() / 1000))]);

  if (formData.summary?.trim()) {
    tags.push(['summary', formData.summary.trim()]);
  }

  if (formData.image?.trim()) {
    tags.push(['image', formData.image.trim()]);
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
 * Create a new article (kind 30023)
 * @param {ArticleFormData} formData
 * @param {string} [communityPubkey] - Optional community to target
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function createArticle(formData, communityPubkey, communityEvent = null) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to create articles.');
  }

  if (!formData.title?.trim()) {
    throw new Error('Title is required');
  }
  if (!formData.content?.trim()) {
    throw new Error('Article content is required');
  }

  const tags = buildArticleTags(formData, undefined, communityPubkey);

  const eventFactory = createAppEventFactory();
  const eventTemplate = await eventFactory.build({
    kind: ARTICLE_KIND,
    content: formData.content,
    tags
  });

  const articleEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(articleEvent, [], { communityEvent });

  const naddr = encodeEventToNaddr(articleEvent, getAppRelaysForCategory('longform'));

  return { event: articleEvent, naddr };
}

/**
 * Update an existing article (kind 30023)
 * @param {ArticleFormData} formData
 * @param {import('nostr-tools').NostrEvent} existingEvent - Existing article to update
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function updateArticle(formData, existingEvent, communityEvent = null) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to update articles.');
  }

  if (existingEvent.pubkey !== currentAccount.pubkey) {
    throw new Error('Cannot update article: you do not own this article.');
  }

  const dTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (!dTag) {
    throw new Error('Cannot update article: missing d-tag.');
  }

  if (!formData.title?.trim()) {
    throw new Error('Title is required');
  }
  if (!formData.content?.trim()) {
    throw new Error('Article content is required');
  }

  // Preserve h-tag if present
  const hTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];

  const tags = buildArticleTags(formData, dTag, hTag || undefined);

  const eventFactory = createAppEventFactory();
  const eventTemplate = await eventFactory.build({
    kind: ARTICLE_KIND,
    content: formData.content,
    tags
  });

  const updatedEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(updatedEvent, [], { communityEvent });

  const naddr = encodeEventToNaddr(updatedEvent, getAppRelaysForCategory('longform'));

  return { event: updatedEvent, naddr };
}
