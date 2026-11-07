/**
 * Relays community-targeted content must reach. Communikey: the `r` relays of
 * a community's kind 10222 are where its content is published — and its
 * enforced relays are the ones that keep it. The targets are read from the
 * event's own `h` tags, so a publish reaches them whether or not the caller
 * passed the community event.
 *
 * Shared by the outbox publish (publish-service.js), community reposts
 * (communityRepost.js) and NIP-09 deletions (eventDeletion.js).
 */
import { firstValueFrom, timeout } from 'rxjs';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import {
  getRelaysForKind,
  getCommunityGlobalRelays,
  getCommunityRelaysByEnforcement
} from '$lib/helpers/communityRelays.js';

/** A community is a pubkey; NIP-29 group ids (UUIDs) never look like one. */
const COMMUNITY_PUBKEY = /^[0-9a-f]{64}$/;

/** How long a publish waits for a community 10222 that is not in the store yet. */
export const COMMUNITY_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Community pubkeys an event targets: its `h` values that are pubkeys.
 * @param {any} event
 * @returns {string[]}
 */
export function getTargetCommunityPubkeys(event) {
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  const pubkeys = tags
    .filter(
      (/** @type {any} */ t) =>
        Array.isArray(t) && t[0] === 'h' && typeof t[1] === 'string' && COMMUNITY_PUBKEY.test(t[1])
    )
    .map((/** @type {string[]} */ t) => t[1]);
  return [...new Set(pubkeys)];
}

/**
 * The community's kind 10222: the store's copy, else a bounded lookup.
 * @param {string} pubkey
 * @returns {Promise<any>}
 */
async function loadCommunityEvent(pubkey) {
  const known = eventStore.getReplaceable(10222, pubkey);
  if (known) return known;
  /** @type {any} */
  let loaded;
  try {
    // Dynamic: the loaders' module graph (IDB cache, liveness) stays out of
    // the publish path until a lookup is actually needed.
    const { addressLoader } = await import('$lib/loaders/base.js');
    loaded = await firstValueFrom(
      addressLoader({ kind: 10222, pubkey, relays: getAllLookupRelays() }).pipe(
        timeout(COMMUNITY_LOOKUP_TIMEOUT_MS)
      ),
      { defaultValue: undefined }
    );
  } catch {
    // Timeout or lookup failure: the caller falls back to the communikey app relays.
  }
  return eventStore.getReplaceable(10222, pubkey) ?? loaded;
}

/**
 * Relays content of `kind` must reach for the given communities: the
 * communikey app relays (also the fallback when a 10222 cannot be found),
 * plus per community its relays for that kind, its global relays and its
 * enforced relays. Empty when there is no community.
 *
 * @param {number} kind
 * @param {string[]} communityPubkeys
 * @param {any[]} [communityEvents] - 10222s already in hand (used instead of a lookup)
 * @returns {Promise<string[]>}
 */
export async function resolveCommunityPublishRelays(kind, communityPubkeys, communityEvents = []) {
  const given = communityEvents.filter(Boolean);
  if (communityPubkeys.length === 0 && given.length === 0) return [];

  const byPubkey = new Map(given.map((e) => [e.pubkey, e]));
  const looked = await Promise.all(
    communityPubkeys.filter((p) => !byPubkey.has(p)).map(loadCommunityEvent)
  );

  const relays = new Set(getAppRelaysForCategory('communikey'));
  for (const communityEvent of [...given, ...looked]) {
    if (!communityEvent) continue;
    for (const r of getRelaysForKind(communityEvent, kind)) relays.add(r);
    for (const r of getCommunityGlobalRelays(communityEvent)) relays.add(r);
    for (const r of getCommunityRelaysByEnforcement(communityEvent).enforced) relays.add(r);
  }
  return [...relays];
}
