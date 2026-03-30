/**
 * Reaction helper functions for NIP-25 reactions
 * Handles creating, publishing, and deleting reactions
 */
import { EventFactory } from 'applesauce-core/event-factory';
import { publishEvent } from '$lib/services/publish-service.js';
import { manager } from '$lib/stores/accounts.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';

/**
 * Check if an event is addressable (replaceable)
 * @param {any} event - The event to check
 * @returns {boolean}
 */
function isAddressableEvent(event) {
  return event.kind >= 30000 && event.kind < 40000;
}

/**
 * Get the addressable coordinate for an event (kind:pubkey:d-tag)
 * @param {any} event - The event
 * @returns {string|null}
 */
function getEventAddress(event) {
  if (!isAddressableEvent(event)) return null;

  const dTag = event.tags.find((/** @type {any} */ tag) => tag[0] === 'd');
  const dValue = dTag ? dTag[1] : '';

  return `${event.kind}:${event.pubkey}:${dValue}`;
}

/**
 * Create a NIP-25 reaction event
 *
 * @param {any} targetEvent - The event being reacted to
 * @param {string} content - The reaction content (emoji, +, -, etc.)
 * @param {Object} [options] - Optional configuration
 * @param {string[]} [options.relays] - Relay hints
 * @returns {Promise<any>} The signed reaction event
 */
export async function createReaction(targetEvent, content, options = {}) {
  const account = manager.active;

  if (!account?.signer) {
    throw new Error('No account or signer available');
  }

  // Get relay hint for the target event author
  const relayHint = options.relays?.[0] || (await getPrimaryWriteRelay(targetEvent.pubkey));

  // Build tags according to NIP-25
  const tags = [];

  // Always add 'e' tag with event id
  tags.push(['e', targetEvent.id, relayHint, targetEvent.pubkey]);

  // Add 'p' tag for the event author
  tags.push(['p', targetEvent.pubkey, relayHint]);

  // For addressable events, add 'a' tag
  if (isAddressableEvent(targetEvent)) {
    const address = getEventAddress(targetEvent);
    if (address) {
      tags.push(['a', address, relayHint, targetEvent.pubkey]);
    }
  }

  // Add 'k' tag with the kind of the reacted event
  tags.push(['k', String(targetEvent.kind)]);

  // Create EventFactory with the signer
  const factory = new EventFactory({
    signer: account.signer
  });

  // Build the unsigned event
  const unsignedEvent = await factory.build({
    kind: 7, // NIP-25 reaction kind
    content: content || '+', // Default to "like" if no content
    tags
  });

  // Sign the event using EventFactory
  const signedEvent = await factory.sign(unsignedEvent);

  return signedEvent;
}

/**
 * Publish a reaction to an event
 *
 * @param {any} targetEvent - The event to react to
 * @param {string} content - The reaction content (emoji, +, -, etc.)
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list
 * @returns {Promise<{success: boolean, event: any, relays: string[], successCount: number}>}
 */
export async function publishReaction(targetEvent, content, options = {}) {
  try {
    // Create the reaction event
    const reactionEvent = await createReaction(targetEvent, content, options);

    // Publish using outbox model (tags target event author)
    const result = await publishEvent(reactionEvent, [targetEvent.pubkey], {
      additionalRelays: options.relays || []
    });

    // Add to EventStore for immediate UI updates
    if (result.success) {
      eventStore.add(reactionEvent);
    }

    return {
      ...result,
      event: reactionEvent
    };
  } catch (error) {
    console.error('Failed to publish reaction:', error);
    throw error;
  }
}

/**
 * Delete a reaction event
 * Uses idiomatic applesauce pattern with factory.delete() and EventStore
 *
 * @param {any} reactionEvent - The reaction event to delete
 * @param {Object} [options] - Publishing options
 * @param {string[]} [options.relays] - Custom relay list
 * @returns {Promise<{success: boolean, event: any, relays: string[], successCount: number}>}
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

  // Publish deletion using outbox model
  const result = await publishEvent(deleteEvent, [], {
    additionalRelays: options.relays || []
  });

  // Explicitly add deletion event to EventStore after successful publish
  // This triggers automatic removal of the referenced reaction event
  // and updates all subscriptions (including ReactionsModel)
  if (result.success) {
    eventStore.add(deleteEvent);
  }

  return {
    ...result,
    event: deleteEvent
  };
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
