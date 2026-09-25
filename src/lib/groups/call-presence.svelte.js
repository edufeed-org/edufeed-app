// Live kind-39004 ("who is in the AV room") for ONE group.
//
// Same trust shape as channel-metadata.svelte.js for kind-39000: the event
// is relay-authored, so it is pinned to the relay's NIP-11 key — no request
// before the key race settles (a forged event collected in that gap would be
// drawn), pinned as soon as the key is known, unpinned only when the window
// expires with no NIP-11 answer at all, and every event re-checked against
// the pin on arrival in case the relay does not enforce its own `authors`.
//
// A standing subscription rather than a one-shot request: the relay
// re-signs the list on every LiveKit join/leave webhook and clients are
// "expected to be actively subscribed to it" (NIP-29).
//
// State is $state.raw: values come from an external store (see the note in
// channel-metadata.svelte.js).
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { raceRelayKey } from './relay-key-race.js';
import { isTrustedSigner } from './relay-directory.js';
import { callPresenceFilter, parseCallParticipants } from './call-presence.js';

/**
 * @param {() => {id: string, relay: string} | null | undefined} getPointer
 *   null/undefined opens nothing (e.g. while the group has no `livekit` tag)
 * @returns {() => {participants: string[], answered: boolean}}
 */
export function useCallPresence(getPointer) {
  /** @type {string[]} */
  let participants = $state.raw([]);
  // True once the relay has answered (EOSE or error) — lets a caller tell
  // "nobody in the room" from "not heard back yet".
  let answered = $state(false);
  // Effect 1 → effect 2: the relay's NIP-11 key(s) and whether it is safe
  // to ask yet. Effect 1 only writes these; effect 2 only reads them.
  /** @type {string[]} */
  let authors = $state.raw([]);
  let ready = $state(false);

  // Effect 1 — race the relay key for the current pointer's relay.
  $effect(() => {
    const pointer = getPointer();
    const relay = pointer?.relay ? normalizeURL(pointer.relay) : null;
    authors = [];
    ready = false;
    if (!relay) return;
    return raceRelayKey(relay, {
      onAuthors: (resolved) => {
        authors = resolved;
      },
      onReady: () => {
        ready = true;
      }
    });
  });

  // Effect 2 — the standing 39004 subscription, only once effect 1 says the
  // relay is ready, re-opened (pinned) if the key arrives later.
  $effect(() => {
    const pointer = getPointer();
    const isReady = ready;
    const pinned = authors;
    participants = [];
    answered = false;
    if (!pointer?.id || !pointer.relay || !isReady) return;

    const relay = normalizeURL(pointer.relay);
    // Newest-wins: the relay replaces the whole list on every change, and a
    // late-arriving older copy must not resurrect someone who already left.
    let newest = -1;
    const sub = pool
      .relay(relay)
      .subscription([callPresenceFilter(pointer.id, pinned)])
      .subscribe({
        next: (/** @type {any} */ event) => {
          if (event === 'EOSE') {
            answered = true;
            return;
          }
          if (!event || typeof event !== 'object') return;
          if (!isTrustedSigner(event, pinned)) return;
          if (typeof event.created_at !== 'number' || event.created_at < newest) return;
          newest = event.created_at;
          participants = parseCallParticipants(event);
        },
        // Best-effort: an unreachable relay means "unknown", not an error
        // the chat should surface — the count just stays empty.
        error: () => {
          answered = true;
        }
      });
    return () => sub.unsubscribe();
  });

  return () => ({ participants, answered });
}
