/**
 * Pin List Service
 *
 * Manages kind 10001 pin lists. A pin list is keyed by an explicit
 * `ownerPubkey` — either a community's own pubkey (PinnedSection, signed
 * with the community's key via getCommunitySigner, which may differ from
 * the active account for separate-keypair owners — handoff #12) or the
 * active user's own pubkey for the personal "feature on my profile" pin
 * list (ProfileFeedView/ProfileContentTab/EventContextMenu). Every write
 * signs with getCommunitySigner(ownerPubkey), never `manager.active`
 * directly — for the personal case that resolves to the active account's
 * own signer (registered under its own pubkey), so behavior there is
 * unchanged; for the community case it resolves to whichever account holds
 * the community's key.
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
import { getCommunitySigner } from '$lib/helpers/community-signer.js';
import { publishEvent } from '$lib/services/publish-service.js';

/**
 * Get the current pin list event for the given owner pubkey.
 * @param {string} ownerPubkey
 * @returns {import('nostr-tools').NostrEvent | null}
 */
function getCurrentPinList(ownerPubkey) {
  if (!ownerPubkey) return null;
  return eventStore.getReplaceable(10001, ownerPubkey) ?? null;
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
 * Pin an event to the given owner's pin list
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} ownerPubkey
 */
export async function pinEvent(event, ownerPubkey) {
  if (isPinned(event, ownerPubkey)) {
    throw new Error('Already pinned');
  }

  const op = isAddressableKind(event.kind)
    ? addAddressPointerTag(event)
    : addEventPointerTag(event.id);

  const operation = modifyPublicTags(op);
  await modifyPinList(ownerPubkey, operation);
}

/**
 * Unpin an event from the given owner's pin list
 * @param {import('nostr-tools').NostrEvent} event
 * @param {string} ownerPubkey
 */
export async function unpinEvent(event, ownerPubkey) {
  const op = isAddressableKind(event.kind)
    ? removeAddressPointerTag(event)
    : removeEventPointerTag(event.id);

  const operation = modifyPublicTags(op);
  await modifyPinList(ownerPubkey, operation);
}

/**
 * Modify the pin list with a given operation, sign, publish, and optimistically update EventStore.
 * Signs with the OWNER's key (getCommunitySigner), not the active account —
 * the two differ for a community run from a separate keypair (handoff #12).
 * @param {string} ownerPubkey
 * @param {import('applesauce-core/factories').EventOperation} operation
 */
async function modifyPinList(ownerPubkey, operation) {
  const signer = getCommunitySigner(ownerPubkey);
  if (!signer) throw new Error('No signer available for this pubkey');

  const factory = createAppEventFactory({ signer });
  const existing = getCurrentPinList(ownerPubkey);

  const template = existing
    ? await factory.modify(existing, operation)
    : await factory.build({ kind: 10001, pubkey: ownerPubkey }, operation);

  const signed = await factory.sign(template);
  await publishEvent(signed, []);
  eventStore.add(signed);
}

/**
 * Reorder pins by swapping two tag positions
 * @param {string} ownerPubkey
 * @param {number} fromIndex
 * @param {number} toIndex
 */
export async function reorderPins(ownerPubkey, fromIndex, toIndex) {
  const pinList = eventStore.getReplaceable(10001, ownerPubkey);
  if (!pinList) throw new Error('No pin list');

  const pinTags = pinList.tags.filter((t) => t[0] === 'e' || t[0] === 'a');
  const otherTags = pinList.tags.filter((t) => t[0] !== 'e' && t[0] !== 'a');

  if (fromIndex < 0 || fromIndex >= pinTags.length) return;
  if (toIndex < 0 || toIndex >= pinTags.length) return;

  // Swap
  const temp = pinTags[fromIndex];
  pinTags[fromIndex] = pinTags[toIndex];
  pinTags[toIndex] = temp;

  const signer = getCommunitySigner(ownerPubkey);
  if (!signer) throw new Error('No signer available for this pubkey');

  const factory = createAppEventFactory({ signer });
  const newTags = [...otherTags, ...pinTags];

  const template = await factory.build({ kind: 10001, pubkey: ownerPubkey, tags: newTags });
  const signed = await factory.sign(template);
  await publishEvent(signed, []);
  eventStore.add(signed);
}
