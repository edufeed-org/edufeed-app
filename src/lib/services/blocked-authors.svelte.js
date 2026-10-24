/**
 * BLOCKED_PUBKEYS — authors a deployment does not show anywhere.
 *
 * The gate is the shared EventStore's `verifyEvent`: a blocked author's event
 * fails it and `add()` returns null, so it never reaches a model, a feed, a
 * preview, the community list or the calendar — every surface is covered by
 * one rule, including the IDB cache (its events pass `add()` too). Events
 * that were stored before the list resolved are removed once it has.
 *
 * Entries: npub / hex pubkeys or kind 30000 list naddrs (`pubkey-lists`).
 * Deployment-level: this is the operator's list, not a user mute list.
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { createPubkeyList } from '$lib/services/pubkey-lists.svelte.js';

/** @type {import('$lib/services/pubkey-lists.svelte.js').PubkeyList | null} */
let list = null;
let gateInstalled = false;

/** Drop everything the store already holds from blocked authors. */
function purgeStored() {
  if (!list || list.pubkeys.length === 0) return;
  for (const event of eventStore.getByFilters({ authors: list.pubkeys })) eventStore.remove(event);
}

/**
 * Read `BLOCKED_PUBKEYS` from the runtime config, install the store gate and
 * resolve the lists. Call once after the config is ready; safe to call again.
 */
export async function initBlockedAuthors() {
  const entries = runtimeConfig.blockedPubkeys || [];
  if (entries.length === 0 || list) return list?.ready;
  list = createPubkeyList('blocked', entries);
  if (!gateInstalled) {
    gateInstalled = true;
    const previous = eventStore.verifyEvent;
    eventStore.verifyEvent = (event) =>
      !isBlockedAuthor(event.pubkey) && (previous ? previous(event) !== false : true);
  }
  purgeStored();
  await list.ready;
  purgeStored();
}

/** @param {string | undefined} pubkey */
export function isBlockedAuthor(pubkey) {
  return !!pubkey && !!list && list.has(pubkey);
}

/** Bumps when the resolved list changes (read in a $derived). */
export function getBlockedAuthorsVersion() {
  return list?.version ?? 0;
}

export function _resetBlockedAuthorsForTesting() {
  list = null;
  gateInstalled = false;
}
