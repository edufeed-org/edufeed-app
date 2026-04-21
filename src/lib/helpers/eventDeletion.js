import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import {
  kindToAppRelayCategory,
  getAppRelaysForCategory
} from '$lib/services/app-relay-service.svelte.js';

/**
 * Delete a calendar event using NIP-09 deletion
 * Thin wrapper around deleteEvent() with calendar-specific validation
 * @param {any} event - The calendar event to delete (can be raw event or processed)
 * @param {any} activeUser - The active user with signer
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteCalendarEvent(event, activeUser) {
  // Calendar events are addressable and require a d-tag
  const dTag = event?.dTag || event?.tags?.find((/** @type {any[]} */ t) => t[0] === 'd')?.[1];
  if (!dTag) {
    return { success: false, error: 'Invalid calendar event: missing d-tag' };
  }

  return deleteEvent(event, activeUser);
}

/**
 * Delete any Nostr event using NIP-09 deletion (unified helper)
 * Automatically determines relay category from event kind
 * @param {any} event - The Nostr event to delete
 * @param {any} activeUser - The active user with signer
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteEvent(event, activeUser) {
  if (!activeUser || !event) {
    return { success: false, error: 'Missing required parameters' };
  }

  const kind = event.kind;
  const pubkey = event.pubkey;

  if (!kind || !pubkey) {
    return { success: false, error: 'Invalid event data' };
  }

  // Verify ownership
  if (pubkey !== activeUser.pubkey) {
    return { success: false, error: 'You can only delete your own events' };
  }

  try {
    // Create EventFactory
    const factory = createAppEventFactory({
      signer: activeUser.signer
    });

    // Use factory.delete() - properly constructs NIP-09 deletion events
    const eventToDelete = event.originalEvent || event;

    const deleteTemplate = await factory.delete([eventToDelete]);
    const signedDelete = await factory.sign(deleteTemplate);

    // OPTIMISTIC UI: Add to EventStore IMMEDIATELY
    eventStore.add(signedDelete);

    // Determine additional relays based on event kind
    const category = kindToAppRelayCategory(kind);
    const additionalRelays = category ? getAppRelaysForCategory(category) : [];

    // Publish in background
    publishEventOptimistic(signedDelete, [], {
      additionalRelays
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to delete event:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}
