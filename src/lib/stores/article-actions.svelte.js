/**
 * Article Actions Store
 * Actions for creating and managing long-form articles (NIP-23, kind 30023)
 */

import { repairNostrLinks, tagPubkeyMentions } from 'applesauce-core/operations';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { pTagPubkeys } from '$lib/helpers/mention-autocomplete.js';
import { manager } from '$lib/stores/accounts.svelte';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { nextCreatedAt } from '$lib/helpers/replaceableUpdates.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getSha256FromURL } from 'applesauce-common/helpers';
import { collectImetaTags } from '$lib/helpers/imeta.js';
import {
  appendCreatorPTags,
  appendFlattenedPeopleTags
} from '$lib/helpers/educational/eventTags.js';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
import { normalizePubkey } from '$lib/helpers/pubkey.js';
import {
  ARTICLE_LICENSE_TAG,
  ARTICLE_SOURCE_TAG,
  ARTICLE_CHANGES_TAG
} from '$lib/helpers/article-attribution.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';
import { announceProtectedPublish } from '$lib/helpers/protected-publish-feedback.js';

/** Kind number for NIP-23 long-form articles */
export const ARTICLE_KIND = 30023;
/**
 * NIP-23 draft: same structure as kind 30023, invisible to every feed (they
 * query 30023 only) but readable by anyone who has the naddr — the preview
 * link an author sends around for approval. Unlisted, not private.
 */
export const ARTICLE_DRAFT_KIND = 30024;

/** @typedef {{ draft?: boolean }} ArticlePublishOptions - `draft: true` saves a kind 30024 */

/**
 * @typedef {Object} ArticleFormData
 * @property {string} title - Article title
 * @property {string} content - Markdown content
 * @property {string} [summary] - Optional summary
 * @property {string} [image] - Optional cover image URL
 * @property {string} [imageHash] - SHA-256 of the cover image (for NIP-94 license attestation lookup)
 * @property {import('nostr-tools').NostrEvent | null} [imageLicenseEvent] - The cover's kind-1063 license attestation; rebroadcast with the article so its relays can resolve the badge
 * @property {string[]} [hashtags] - Optional hashtags
 * @property {boolean} [protected] - NIP-70: add the `["-"]` tag, so only relays that AUTH the author store it and nobody can rebroadcast it
 * @property {Array<Partial<import('$lib/helpers/imeta.js').MediaAttachment> & { url?: string }>} [media] - Images inserted into the body this session (NIP-94 fields from the upload); become NIP-92 imeta tags for the URLs still present in `content`
 * @property {import('$lib/stores/educational-actions.svelte.js').Creator[]} [creators] - Credited people (authors / contributors); see `$lib/helpers/article-attribution.js` for the wire form
 * @property {string} [license] - License URL (`license:id`)
 * @property {string} [source] - Where the text originally appeared (TULLU Ursprungsort, `source`)
 * @property {string} [changes] - Modification note (`changes`)
 */

/**
 * Events that travel with the article to the same relay set.
 * @param {ArticleFormData} formData
 * @returns {import('nostr-tools').NostrEvent[]}
 */
function companionsOf(formData) {
  return formData.imageLicenseEvent ? [formData.imageLicenseEvent] : [];
}

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
 * @param {string[][]} [existingTags] - Tags of the version being replaced (updates): their imeta tags are carried over while the URL is still in the body
 * @returns {string[][]}
 */
export function buildArticleTags(formData, dTag, communityPubkey, existingTags = []) {
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

  const resolvedHash =
    formData.imageHash?.trim() ||
    (formData.image?.trim() ? getSha256FromURL(formData.image.trim()) : null);
  if (resolvedHash) {
    tags.push(['x', resolvedHash]);
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

  // Authorship / license / TULLU provenance (all optional).
  if (formData.license?.trim()) tags.push([ARTICLE_LICENSE_TAG, formData.license.trim()]);
  if (formData.source?.trim()) tags.push([ARTICLE_SOURCE_TAG, formData.source.trim()]);
  if (formData.changes?.trim()) tags.push([ARTICLE_CHANGES_TAG, formData.changes.trim()]);
  appendFlattenedPeopleTags(tags, formData.creators);
  if (formData.protected) {
    tags.push(['-']);
  }

  // NIP-92: one imeta per body image whose URL is still in the markdown.
  tags.push(...collectImetaTags(formData.content, formData.media ?? [], existingTags));

  return tags;
}

/**
 * Credit the linked people with `["p", pk, relay, "creator"|"contributor"]`
 * AFTER the factory build: `tagPubkeyMentions()` merges a body mention into
 * an existing p-tag for the same pubkey and drops its marker, so the marked
 * tag has to be the last word. An earlier plain mention tag of that person
 * is replaced, not duplicated.
 * @param {import('nostr-tools').EventTemplate} template - Mutated
 * @param {ArticleFormData} formData
 */
async function creditLinkedPeople(template, formData) {
  const linked = (formData.creators || []).flatMap((c) => {
    const pk = normalizePubkey(c.pubkey);
    return pk ? [pk] : [];
  });
  if (linked.length === 0) return;
  template.tags = template.tags.filter((t) => !(t[0] === 'p' && linked.includes(t[1])));
  await appendCreatorPTags(template.tags, formData.creators, getPrimaryWriteRelay);
}

/**
 * Create a new article (kind 30023)
 * @param {ArticleFormData} formData
 * @param {string} [communityPubkey] - Optional community to target
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @param {ArticlePublishOptions} [options]
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function createArticle(
  formData,
  communityPubkey,
  communityEvent = null,
  options = {}
) {
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
  // NIP-27 references in the body become NIP-10 p tags (bare npubs repaired first).
  const eventTemplate = await eventFactory.build(
    {
      kind: options.draft ? ARTICLE_DRAFT_KIND : ARTICLE_KIND,
      content: formData.content,
      tags
    },
    repairNostrLinks(),
    tagPubkeyMentions()
  );
  await creditLinkedPeople(eventTemplate, formData);

  const articleEvent = await currentAccount.signEvent(eventTemplate);
  // Mentioned users get the article on their read relays too.
  publishEventOptimistic(articleEvent, pTagPubkeys(articleEvent), {
    communityEvent,
    companions: companionsOf(formData),
    onStatusChange: formData.protected ? announceProtectedPublish : undefined
  });

  const naddr = encodeEventToNaddr(articleEvent, getAppRelaysForCategory('longform'));

  return { event: articleEvent, naddr };
}

/**
 * Update an existing article (kind 30023)
 * @param {ArticleFormData} formData
 * @param {import('nostr-tools').NostrEvent} existingEvent - Existing article or draft to update
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @param {ArticlePublishOptions} [options] - `draft: true` keeps a draft a draft; a
 *   draft saved without it is published as kind 30023 and the draft retired
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function updateArticle(formData, existingEvent, communityEvent = null, options = {}) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to update articles.');
  }

  if (existingEvent.pubkey !== currentAccount.pubkey) {
    throw new Error('Cannot update article: you do not own this article.');
  }

  const wasDraft = existingEvent.kind === ARTICLE_DRAFT_KIND;
  if (options.draft && !wasDraft) {
    // A published article has readers; a draft shadowing it would only confuse.
    throw new Error('Cannot save as draft: this article is already published.');
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

  const tags = buildArticleTags(formData, dTag, hTag || undefined, existingEvent.tags);

  const eventFactory = createAppEventFactory();
  // Strictly newer than the version being replaced — a same-second edit is
  // dropped by the relay tie-break and deterministically by the cache. (#62/#64)
  const eventTemplate = await eventFactory.build(
    {
      kind: options.draft ? ARTICLE_DRAFT_KIND : ARTICLE_KIND,
      content: formData.content,
      tags,
      created_at: nextCreatedAt(existingEvent)
    },
    repairNostrLinks(),
    tagPubkeyMentions()
  );
  await creditLinkedPeople(eventTemplate, formData);

  const updatedEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(updatedEvent, pTagPubkeys(updatedEvent), {
    communityEvent,
    companions: companionsOf(formData),
    onStatusChange: formData.protected ? announceProtectedPublish : undefined
  });
  if (wasDraft && !options.draft) await retireDraft(existingEvent, currentAccount);

  const naddr = encodeEventToNaddr(updatedEvent, getAppRelaysForCategory('longform'));

  return { event: updatedEvent, naddr };
}

/**
 * NIP-09 the draft once its kind-30023 successor is out. Best effort: the
 * article is already published, a lingering draft only costs a stale preview.
 * @param {import('nostr-tools').NostrEvent} draft
 * @param {any} account
 */
async function retireDraft(draft, account) {
  try {
    const result = await deleteEvent(draft, account);
    if (!result.success) console.warn('Draft could not be retired:', result.error);
  } catch (err) {
    console.warn('Draft could not be retired:', err);
  }
}

/**
 * Publish a kind-30024 draft as it is: same content and tags (so credited
 * people, license and provenance survive), fresh `published_at`, kind 30023
 * under the same d-tag; then retire the draft.
 * @param {import('nostr-tools').NostrEvent} draft
 * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community event for relay routing
 * @returns {Promise<{event: import('nostr-tools').NostrEvent, naddr: string}>}
 */
export async function publishDraft(draft, communityEvent = null) {
  const currentAccount = manager.active;
  if (!currentAccount) {
    throw new Error('No account selected. Please log in to publish.');
  }
  if (draft.kind !== ARTICLE_DRAFT_KIND) {
    throw new Error('Not a draft: only kind 30024 drafts can be published this way.');
  }
  if (draft.pubkey !== currentAccount.pubkey) {
    throw new Error('Cannot publish draft: you do not own this draft.');
  }

  const now = String(Math.floor(Date.now() / 1000));
  const tags = draft.tags.filter((t) => t[0] !== 'published_at');
  tags.push(['published_at', now]);

  const eventFactory = createAppEventFactory();
  const eventTemplate = await eventFactory.build({
    kind: ARTICLE_KIND,
    content: draft.content,
    tags
  });
  const articleEvent = await currentAccount.signEvent(eventTemplate);
  publishEventOptimistic(articleEvent, pTagPubkeys(articleEvent), { communityEvent });
  await retireDraft(draft, currentAccount);

  const naddr = encodeEventToNaddr(articleEvent, getAppRelaysForCategory('longform'));
  return { event: articleEvent, naddr };
}
