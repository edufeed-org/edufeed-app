/**
 * Meet Presence Service
 * Publishes kind 10312 presence events while in a room, deletes on leave.
 */
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';

const PRESENCE_KIND = 10312;
const PRESENCE_INTERVAL_MS = 30_000;

/** @type {ReturnType<typeof setInterval> | null} */
let presenceInterval = null;

/** @type {any} */
let lastPresenceEvent = null;

/**
 * Start publishing presence for a room.
 * @param {string} roomCoordinate - "30312:<pubkey>:<d-tag>"
 * @param {string} communityPubkey
 */
export async function startPresence(roomCoordinate, communityPubkey) {
  stopPresence();
  await publishPresence(roomCoordinate, communityPubkey);
  presenceInterval = setInterval(
    () => publishPresence(roomCoordinate, communityPubkey),
    PRESENCE_INTERVAL_MS
  );
}

/**
 * Stop publishing presence and delete the last presence event.
 */
export async function stopPresence() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }

  if (lastPresenceEvent && manager.active) {
    try {
      await deleteEvent(lastPresenceEvent, manager.active);
    } catch (err) {
      console.error('Failed to delete presence event:', err);
    }
    lastPresenceEvent = null;
  }
}

/**
 * Publish a single presence event.
 * @param {string} roomCoordinate
 * @param {string} communityPubkey
 */
async function publishPresence(roomCoordinate, communityPubkey) {
  if (!manager.active) return;

  try {
    const factory = createAppEventFactory({ signer: manager.signer });
    const draft = {
      kind: PRESENCE_KIND,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['a', roomCoordinate],
        ['h', communityPubkey]
      ]
    };

    const signed = await factory.sign(draft);
    const communityEvent = eventStore.getReplaceable(10222, communityPubkey);
    await publishEvent(signed, [communityPubkey], { communityEvent });
    lastPresenceEvent = signed;
  } catch (err) {
    console.error('Failed to publish presence:', err);
  }
}
