/**
 * Which Termi result items get a card: titled, a known type, not by a blocked
 * author, and — for events — not from a hidden calendar source unless the
 * calendar's "Importierte Termine anzeigen" setting is on.
 */
import { isBlockedAuthor } from '$lib/services/blocked-authors.svelte.js';
import { isHiddenCalendarSource } from '$lib/services/calendar-sources.svelte.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';

/** @typedef {import('$lib/termi/items.d.js').Item} Item */

export const CARD_TYPES = ['community', 'event', 'resource', 'person', 'passage'];

/** Person/community ids are pubkeys; everything else must carry `pubkey`. @param {Item} it */
const pubkeyOf = (it) =>
  it.pubkey ?? (it.type === 'person' || it.type === 'community' ? it.id : undefined);

/** @param {Item} it */
export function keepItem(it) {
  return (
    !!it?.title &&
    CARD_TYPES.includes(it.type) &&
    !isBlockedAuthor(pubkeyOf(it)) &&
    !(
      it.type === 'event' &&
      !appSettings.showHiddenCalendarSources &&
      isHiddenCalendarSource(pubkeyOf(it))
    )
  );
}
