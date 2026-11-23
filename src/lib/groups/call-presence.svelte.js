// Live kind-39004 ("who is in the AV room") for ONE group.
//
// The trust rules (relay key pin, newest wins) and the standing, reopening
// subscription live in call-presence-watch.js, shared with the dashboard's
// many-group watcher.
//
// State is $state.raw: values come from an external store (see the note in
// channel-metadata.svelte.js).
import { normalizeURL } from 'applesauce-core/helpers/url';
import { watchRelayCalls } from './call-presence-watch.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

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
  const getUser = useActiveUser();

  // The standing 39004 watch for the current pointer.
  $effect(() => {
    const pointer = getPointer();
    participants = [];
    answered = false;
    if (!pointer?.id || !pointer.relay) return;
    return watchRelayCalls(normalizeURL(pointer.relay), [pointer.id], {
      getSigner: () => getUser()?.signer,
      onParticipants: (_id, pubkeys) => {
        participants = pubkeys;
      },
      onAnswered: () => {
        answered = true;
      }
    });
  });

  return () => ({ participants, answered });
}
