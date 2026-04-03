/**
 * Reaction helper functions for NIP-25 reactions
 * Handles creating, publishing, and deleting reactions
 */
import { EventFactory } from 'applesauce-core/event-factory';
import { ReactionBlueprint } from 'applesauce-common/blueprints';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { manager } from '$lib/stores/accounts.svelte.js';

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

  const factory = new EventFactory({ signer: account.signer });
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
 * @param {Function} [options.onStatusChange] - Callback for publish status updates
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
 * Delete a reaction event
 * Uses idiomatic applesauce pattern with factory.delete() and EventStore
 *
 * @param {any} reactionEvent - The reaction event to delete
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list
 * @param {Function} [options.onStatusChange] - Callback for publish status updates
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
  const factory = new EventFactory({
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
