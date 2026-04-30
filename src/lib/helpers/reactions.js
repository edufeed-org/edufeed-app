/**
 * Reaction helper functions for NIP-25 reactions
 * Handles creating, publishing, and deleting reactions
 */
import { ReactionBlueprint } from 'applesauce-common/blueprints';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { manager } from '$lib/stores/accounts.svelte.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

/**
 * Create a NIP-25 reaction event using ReactionBlueprint.
 * Accepts a plain string emoji or a NIP-30 custom Emoji object.
 *
 * @param {any} targetEvent - The event being reacted to
 * @param {string | import('applesauce-common/helpers').Emoji} emoji - Reaction emoji (string or {shortcode, url})
 * @returns {Promise<any>} The signed reaction event
 */
export async function createReaction(targetEvent, emoji) {
  const account = manager.active;

  if (!account?.signer) {
    throw new Error('No account or signer available');
  }

  const factory = createAppEventFactory({ signer: account.signer });
  const draft = await factory.create(ReactionBlueprint, targetEvent, emoji || '+');
  return await factory.sign(draft);
}

/**
 * Publish a reaction to an event (optimistic — instant UI update)
 *
 * @param {any} targetEvent - The event to react to
 * @param {string | import('applesauce-common/helpers').Emoji} emoji - Reaction emoji (string or {shortcode, url})
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list
 * @param {((status: import('$lib/services/publish-service.js').PublishStatus) => void)} [options.onStatusChange] - Callback for publish status updates
 * @returns {Promise<{success: boolean, event: any}>}
 */
export async function publishReaction(targetEvent, emoji, options = {}) {
  // Create and sign the reaction event (awaits signing)
  const reactionEvent = await createReaction(targetEvent, emoji);

  // Publish optimistically — adds to EventStore immediately, rolls back on total failure
  publishEventOptimistic(reactionEvent, [targetEvent.pubkey], {
    additionalRelays: options.relays || [],
    onStatusChange: options.onStatusChange
  });

  return { success: true, event: reactionEvent };
}

/**
 * Publish a NIP-25 kind 17 external reaction targeting a URL (NIP-73).
 * Mirror of {@link publishReaction} for URL-rooted threads.
 *
 * @param {string} url - The page URL being reacted to
 * @param {string | { shortcode: string, url: string }} [emoji] - Reaction emoji
 *   (string for unicode, NIP-30 Emoji object for custom). Defaults to '+'.
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list (defaults to communikey relays)
 * @param {((status: import('$lib/services/publish-service.js').PublishStatus) => void)} [options.onStatusChange]
 * @returns {Promise<{success: boolean, event: any}>}
 */
export async function publishReactionForUrl(url, emoji, options = {}) {
  const account = manager.active;

  if (!account?.signer) {
    throw new Error('No account or signer available');
  }

  const factory = createAppEventFactory({ signer: account.signer });

  const tags = [
    ['i', url],
    ['k', 'web']
  ];

  let content;
  if (emoji && typeof emoji === 'object' && 'shortcode' in emoji) {
    // NIP-30 custom emoji: content is :shortcode:, append emoji tag
    content = `:${emoji.shortcode}:`;
    tags.push(['emoji', emoji.shortcode, emoji.url]);
  } else {
    content = /** @type {string|undefined} */ (emoji) ?? '+';
  }

  const draft = {
    kind: 17,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  };

  const signedEvent = await factory.sign(draft);

  publishEventOptimistic(signedEvent, [], {
    additionalRelays: options.relays || getCommunikeyRelays(),
    onStatusChange: options.onStatusChange
  });

  return { success: true, event: signedEvent };
}

/**
 * Delete a reaction event
 * Uses idiomatic applesauce pattern with factory.delete() and EventStore
 *
 * @param {any} reactionEvent - The reaction event to delete
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list
 * @param {((status: import('$lib/services/publish-service.js').PublishStatus) => void)} [options.onStatusChange] - Callback for publish status updates
 * @returns {Promise<{success: boolean, event: any}>}
 */
export async function deleteReaction(reactionEvent, options = {}) {
  const account = manager.active;

  if (!account?.signer) {
    throw new Error('No account or signer available');
  }

  if (reactionEvent.pubkey !== account.pubkey) {
    throw new Error('Cannot delete reaction from another user');
  }

  // Create EventFactory with the signer
  const factory = createAppEventFactory({
    signer: account.signer
  });

  // Use factory.delete() to create proper deletion event (idiomatic applesauce pattern)
  const deleteEventTemplate = await factory.delete([reactionEvent]);

  // Sign the deletion event
  const deleteEvent = await factory.sign(deleteEventTemplate);

  // Publish optimistically — adds deletion to EventStore immediately,
  // triggering automatic removal of the referenced reaction event
  publishEventOptimistic(deleteEvent, [], {
    additionalRelays: options.relays || [],
    onStatusChange: options.onStatusChange
  });

  return { success: true, event: deleteEvent };
}

/**
 * Extract custom emoji image URL from a NIP-30 reaction event.
 * Custom emoji reactions have content ":shortcode:" and an ["emoji", "shortcode", "url"] tag.
 *
 * @param {any} event - A kind 7 reaction event
 * @returns {string|null} The image URL, or null if not a custom emoji reaction
 */
export function getCustomEmojiUrl(event) {
  const content = event.content?.trim();
  if (!content) return null;
  const match = content.match(/^:([^:]+):$/);
  if (!match) return null;
  const shortcode = match[1];
  const emojiTag = event.tags?.find(
    (/** @type {string[]} */ t) => t[0] === 'emoji' && t[1] === shortcode
  );
  return emojiTag?.[2] || null;
}

/**
 * @typedef {Object} ReactionSummary
 * @property {number} count - Number of reactions for this emoji
 * @property {boolean} userReacted - True if currentUserPubkey reacted with this emoji
 * @property {any} userReactionEvent - The current user's reaction event (or null)
 * @property {string|null} emojiUrl - Custom emoji URL (NIP-30) or null for unicode
 * @property {string[]} reactors - Pubkeys of all users who reacted with this emoji
 */

/**
 * Aggregate a list of reaction events into emoji-keyed summaries.
 * Pure function — used by both event-rooted and URL-rooted reaction bars.
 *
 * @param {any[]} events - Reaction events (kind 7 or kind 17)
 * @param {string|undefined} currentUserPubkey - Active user's pubkey (or undefined)
 * @returns {Map<string, ReactionSummary>} Map keyed by normalized emoji
 */
export function aggregateReactions(events, currentUserPubkey) {
  const agg = new Map();

  for (const reaction of events) {
    const emoji = normalizeReactionContent(reaction.content);
    const existing = agg.get(emoji) || {
      count: 0,
      userReacted: false,
      userReactionEvent: null,
      emojiUrl: null,
      reactors: []
    };

    const isUserReaction = !!currentUserPubkey && reaction.pubkey === currentUserPubkey;

    existing.reactors.push(reaction.pubkey);
    agg.set(emoji, {
      count: existing.count + 1,
      userReacted: existing.userReacted || isUserReaction,
      userReactionEvent: isUserReaction ? reaction : existing.userReactionEvent,
      emojiUrl: existing.emojiUrl || getCustomEmojiUrl(reaction),
      reactors: existing.reactors
    });
  }

  return agg;
}

/**
 * Normalize reaction content for display
 * Converts + to ❤️ and - to 👎
 *
 * @param {string} content - The raw reaction content
 * @returns {string} Normalized emoji
 */
export function normalizeReactionContent(content) {
  const trimmed = content.trim();

  if (trimmed === '+' || trimmed === '') {
    return '❤️';
  }

  if (trimmed === '-') {
    return '👎';
  }

  return trimmed;
}
