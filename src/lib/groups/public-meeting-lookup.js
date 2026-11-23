// Finds a meeting's public calendar entry (public-meeting.js): the local
// store first, then the calendar relays.
import { lastValueFrom } from 'rxjs';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import { getCalendarRelays } from '$lib/helpers/relay-helper.js';

/**
 * @param {string} pubkey the meeting's author
 * @param {string} dTag `publicCopyDTag(meeting)`
 * @returns {Promise<any | null>}
 */
export async function findPublicCopy(pubkey, dTag) {
  const local = eventStore.getReplaceable(31923, pubkey, dTag);
  if (local) return local;
  await lastValueFrom(
    fetchEvents(getCalendarRelays(), { kinds: [31923], authors: [pubkey], '#d': [dTag] }),
    { defaultValue: null }
  );
  return eventStore.getReplaceable(31923, pubkey, dTag) ?? null;
}
