/**
 * Shared helpers for publishing replaceable and addressable events.
 *
 * Every code path that replaces one version of a replaceable event with another
 * is exposed to the same two hazards. Both were diagnosed on the calendar edit
 * path (#62) and then found at further call sites (#64), so they live here: a
 * new publish site should get them by calling the helper rather than by
 * remembering the reasoning.
 */

import { unixNow } from 'applesauce-core/helpers/time';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * The `created_at` a replacement must carry to actually replace its predecessor.
 *
 * A replacement that lands in the same wall-clock second as the event it
 * replaces is silently dropped by three independent layers, each with its own
 * tie-break:
 *   - relays (NIP-01): on equal `created_at` the LOWER id wins — a coin flip,
 *     so the edit is lost about half the time;
 *   - applesauce's EventStore: same rule, lower id wins
 *     (`event-store.js` `incomingBeatsWinner`);
 *   - nostr-idb: strict `event.created_at > existing` (`database/insert.js`),
 *     so on a tie the IDB write is ALWAYS rejected — and since the cache is the
 *     first step of the address loader and a cache hit ends the sequence, no
 *     relay ever corrects it.
 *
 * Only the relay layer is a coin flip; the cache is deterministically stale,
 * which is why a same-second edit reads as "the save did nothing" even when the
 * relay accepted it.
 *
 * A tie is not exotic: applesauce's `unixNow()` ROUNDS rather than floors
 * (`applesauce-core/helpers/time.js`), so an event stamped at .5-.999 of a
 * second is dated into the next second with no elapsed time at all — two saves
 * can tie with real time between them. Reachable by a user editing straight
 * after creating, and by two tabs. (#62)
 *
 * @param {{created_at?: number} | null | undefined} previous - The event being
 *   replaced, or null/undefined when there is nothing to replace (a create).
 * @returns {number} A `created_at` strictly greater than `previous`.
 */
export function nextCreatedAt(previous) {
  return Math.max(unixNow(), (previous?.created_at ?? 0) + 1);
}

/**
 * Offer a successfully published event to the EventStore, which is what feeds
 * the IndexedDB cache.
 *
 * `publishEvent` — unlike `publishEventOptimistic` — never touches the
 * EventStore, and the cache is fed exclusively from `eventStore.insert$`
 * (`stores/event-cache.svelte.js`). So `await publishEvent(...)` on its own
 * leaves the new version out of the cache. That matters more than it sounds:
 * the cache is the FIRST step of applesauce's `addressPointerLoadingSequence`
 * and a cache hit ENDS the sequence, so for a cacheable kind whatever is in IDB
 * is what the app shows and no relay is ever asked to correct it. (#62, #64)
 *
 * Gated on success for the same reason `publishEventOptimistic` removes the
 * event when no relay accepts it — the cache must not outlive a publish that
 * never landed.
 *
 * Best-effort: `eventStore.add` validates the event and throws on a malformed
 * one. The publish has already landed by this point, so a cache-write failure
 * must not be reported to the user as a failed save — it degrades to the
 * stale-read behaviour, matching the "cache is ADDITIVE" contract in
 * `stores/event-cache.svelte.js`.
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent - The published event.
 *   Must be a plain signed Nostr event: app-local decorations (a `dTag`
 *   property, for instance) fail validation.
 * @param {{success?: boolean} | null | undefined} publishResult - The result
 *   returned by `publishEvent`.
 * @returns {void}
 */
export function cachePublishedEvent(signedEvent, publishResult) {
  if (!publishResult?.success) return;
  try {
    eventStore.add(signedEvent);
  } catch (err) {
    console.warn('[publish] published event not added to the EventStore', err);
  }
}
