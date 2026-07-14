/**
 * Pin List Service
 *
 * Manages kind 10001 pin lists for communities.
 * Uses applesauce tag operations for e/a tag manipulation.
 */
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { isAddressableKind } from 'applesauce-core/helpers/event';
import { modifyPublicTags } from 'applesauce-core/operations/tags';
import {
  addAddressPointerTag,
  addEventPointerTag,
  removeAddressPointerTag,
  removeEventPointerTag
} from 'applesauce-core/operations/tag/common';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';

/**
 * Get the current pin list event for the active user
 * @returns {import('nostr-tools').NostrEvent | null}
 */
function getCurrentPinList() {
  if (!manager.active) return null;
  return eventStore.getReplaceable(10001, manager.active.pubkey) ?? null;
}

/**
 * Build an addressable coordinate string for an event
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string}
 */
function getCoordinate(event) {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Check if an event is already pinned
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} communityPubkey
 * @returns {boolean}
 */
export function isPinned(event, communityPubkey) {
  const pinList = eventStore.getReplaceable(10001, communityPubkey);
  if (!pinList) return false;

  if (isAddressableKind(event.kind)) {
    const coord = getCoordinate(event);
    return pinList.tags.some((t) => t[0] === 'a' && t[1] === coord);
  }
  return pinList.tags.some((t) => t[0] === 'e' && t[1] === event.id);
}

/**
 * Pin an event to the community's pin list
 * @param {import('nostr-tools').NostrEvent} event
 */
export async function pinEvent(event) {
  if (isPinned(event, /** @type {string} */ (manager.active?.pubkey))) {
    throw new Error('Already pinned');
  }

  const op = isAddressableKind(event.kind)
    ? addAddressPointerTag(event)
    : addEventPointerTag(event.id);

  const operation = modifyPublicTags(op);
  await modifyPinList(operation);
}

/**
 * Unpin an event from the community's pin list
 * @param {import('nostr-tools').NostrEvent} event
 */
export async function unpinEvent(event) {
  const op = isAddressableKind(event.kind)
    ? removeAddressPointerTag(event)
    : removeEventPointerTag(event.id);

  const operation = modifyPublicTags(op);
  await modifyPinList(operation);
}

/**
 * Modify the pin list with a given operation, sign, publish, and optimistically update EventStore.
 * @param {import('applesauce-core/factories').EventOperation} operation
 */
async function modifyPinList(operation) {
  const signer = manager.active?.signer;
  if (!signer) throw new Error('No active signer');

  const factory = createAppEventFactory({ signer });
  const existing = getCurrentPinList();

  const template = existing
    ? await factory.modify(existing, operation)
    : await factory.build({ kind: 10001 }, operation);

  const signed = await factory.sign(template);
  await publishEvent(signed, []);
  eventStore.add(signed);
}

/**
 * Reorder pins by swapping two tag positions
 * @param {string} communityPubkey
 * @param {number} fromIndex
 * @param {number} toIndex
 */
export async function reorderPins(communityPubkey, fromIndex, toIndex) {
  const pinList = eventStore.getReplaceable(10001, communityPubkey);
  if (!pinList) throw new Error('No pin list');

  const pinTags = pinList.tags.filter((t) => t[0] === 'e' || t[0] === 'a');
  const otherTags = pinList.tags.filter((t) => t[0] !== 'e' && t[0] !== 'a');

  if (fromIndex < 0 || fromIndex >= pinTags.length) return;
  if (toIndex < 0 || toIndex >= pinTags.length) return;

  // Swap
  const temp = pinTags[fromIndex];
  pinTags[fromIndex] = pinTags[toIndex];
  pinTags[toIndex] = temp;

  const signer = manager.active?.signer;
  if (!signer) throw new Error('No active signer');

  const factory = createAppEventFactory({ signer });
  const newTags = [...otherTags, ...pinTags];

  const template = await factory.build({ kind: 10001, tags: newTags });
  const signed = await factory.sign(template);
  await publishEvent(signed, []);
  eventStore.add(signed);
}
