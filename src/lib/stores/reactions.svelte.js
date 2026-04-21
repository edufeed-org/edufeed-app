/**
 * Reactions store using Svelte 5 runes
 * Manages reactive state for NIP-25 reactions across the application
 */
import { SvelteMap } from 'svelte/reactivity';
import { reactionsLoader } from '$lib/loaders/reactions.js';
import {
  normalizeReactionContent,
  getCustomEmojiUrl,
  publishReaction,
  deleteReaction
} from '$lib/helpers/reactions.js';
import { manager } from './accounts.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';
import { eventStore } from './nostr-infrastructure.svelte.js';

/**
 * @typedef {Object} ReactionSummary
 * @property {number} count - Number of reactions
 * @property {boolean} userReacted - Whether current user reacted
 * @property {any} [userReactionEvent] - The user's reaction event if they reacted
 */

/**
 * @typedef {Object} EventReactions
 * @property {any[]} reactions - All reaction events
 * @property {Map<string, ReactionSummary>} aggregated - Aggregated by emoji
 * @property {boolean} loading - Whether reactions are loading
 */

class ReactionsStore {
  /** @type {SvelteMap<string, EventReactions>} */
  #reactionsMap = $state(new SvelteMap());

  /** @type {SvelteMap<string, any>} */
  #subscriptions = new SvelteMap();

  /**
   * Get reactions for an event
   * @param {string} eventId - The event ID
   * @returns {EventReactions}
   */
  getReactions(eventId) {
    return (
      this.#reactionsMap.get(eventId) || {
        reactions: [],
        aggregated: new Map(),
        loading: false
      }
    );
  }

  /**
   * Load reactions for an event
   * @param {any} event - The event to load reactions for
   * @param {string[]} [relays] - Optional relay list
   */
  loadReactions(event, relays) {
    if (!event?.id) return;

    // Check if already loading
    if (this.#subscriptions.has(event.id)) {
      return;
    }

    // Initialize loading state
    this.#reactionsMap.set(event.id, {
      reactions: [],
      aggregated: new Map(),
      loading: true
    });

    // Get relay list
    const relaySources = relays || runtimeConfig.fallbackRelays || [];

    // Subscribe to reactions
    const subscription = reactionsLoader(event, relaySources).subscribe({
      next: (reactionEvent) => {
        this.#addReaction(event.id, reactionEvent);
      },
      error: (error) => {
        console.error('Error loading reactions:', error);
        const current = this.#reactionsMap.get(event.id);
        if (current) {
          this.#reactionsMap.set(event.id, {
            ...current,
            loading: false
          });
        }
      },
      complete: () => {
        const current = this.#reactionsMap.get(event.id);
        if (current) {
          this.#reactionsMap.set(event.id, {
            ...current,
            loading: false
          });
        }
      }
    });

    this.#subscriptions.set(event.id, subscription);
  }

  /**
   * Add a reaction to the store
   * @param {string} eventId - The event ID
   * @param {any} reactionEvent - The reaction event
   */
  #addReaction(eventId, reactionEvent) {
    const current = this.#reactionsMap.get(eventId);
    if (!current) return;

    // Check if reaction already exists
    const exists = current.reactions.some((r) => r.id === reactionEvent.id);
    if (exists) return;

    // Add reaction
    const newReactions = [...current.reactions, reactionEvent];
    const aggregated = this.#aggregateReactions(newReactions);

    this.#reactionsMap.set(eventId, {
      reactions: newReactions,
      aggregated,
      loading: current.loading
    });
  }

  /**
   * Aggregate reactions by emoji
   * @param {any[]} reactions - Array of reaction events
   * @returns {SvelteMap<string, ReactionSummary>}
   */
  #aggregateReactions(reactions) {
    const aggregated = new SvelteMap();
    const currentUser = manager.active;

    for (const reaction of reactions) {
      const emoji = normalizeReactionContent(reaction.content);
      const existing = aggregated.get(emoji) || {
        count: 0,
        userReacted: false,
        userReactionEvent: null,
        emojiUrl: null
      };

      const isUserReaction = currentUser && reaction.pubkey === currentUser.pubkey;

      aggregated.set(emoji, {
        count: existing.count + 1,
        userReacted: existing.userReacted || isUserReaction,
        userReactionEvent: isUserReaction ? reaction : existing.userReactionEvent,
        emojiUrl: existing.emojiUrl || getCustomEmojiUrl(reaction)
      });
    }

    return aggregated;
  }

  /**
   * React to an event (fire-and-forget — UI updates via EventStore subscription)
   * @param {any} event - The event to react to
   * @param {string | import('applesauce-common/helpers').Emoji} emoji - The emoji to react with (string or {shortcode, url})
   * @param {string[]} [relays] - Optional relay list
   */
  react(event, emoji, relays) {
    if (!event?.id) return;

    const currentUser = manager.active;
    if (!currentUser) {
      showToast(m.toast_sign_in_to_react(), 'error');
      return;
    }

    publishReaction(event, emoji, { relays })
      .then((result) => {
        if (!result.success) showToast(m.toast_reaction_failed(), 'error');
      })
      .catch((error) => {
        console.error('Failed to react:', error);
        showToast(m.toast_reaction_failed(), 'error');
      });
  }

  /**
   * Remove a reaction
   * @param {any} event - The event that was reacted to
   * @param {string} emoji - The emoji to remove
   * @param {string[]} [relays] - Optional relay list
   */
  async unreact(event, emoji, relays) {
    if (!event?.id) {
      throw new Error('Invalid event');
    }

    const currentUser = manager.active;
    if (!currentUser) {
      throw new Error('No active account');
    }

    try {
      // Get the user's reaction event for this emoji from the aggregated data
      const eventReactions = this.getReactions(event.id);
      const reactionData = eventReactions.aggregated.get(emoji);

      if (!reactionData?.userReactionEvent) {
        throw new Error('No reaction found to delete');
      }

      // Delete the reaction - pass the REACTION event, not the target event
      console.log('Attempting to delete reaction for emoji:', emoji);
      const { event: deletedEvent } = await deleteReaction(reactionData.userReactionEvent, {
        relays
      });

      // Remove from store
      eventStore.add(deletedEvent);

      showToast(m.toast_reaction_removed(), 'success');
    } catch (error) {
      console.error('Failed to remove reaction:', error);
      showToast(m.toast_reaction_remove_failed(), 'error');
      throw error;
    }
  }

  /**
   * Unload reactions for an event (cleanup)
   * @param {string} eventId - The event ID
   */
  unload(eventId) {
    const subscription = this.#subscriptions.get(eventId);
    if (subscription) {
      subscription.unsubscribe();
      this.#subscriptions.delete(eventId);
    }
    this.#reactionsMap.delete(eventId);
  }

  /**
   * Clear all reactions
   */
  clear() {
    for (const subscription of this.#subscriptions.values()) {
      subscription.unsubscribe();
    }
    this.#subscriptions.clear();
    this.#reactionsMap.clear();
  }
}

// Export singleton instance
export const reactionsStore = new ReactionsStore();
