import { getSeenRelays } from 'applesauce-core/helpers';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { publishEvent } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { cacheDeletion } from '$lib/stores/event-cache.svelte.js';
import {
  kindToAppRelayCategory,
  getAppRelaysForCategory
} from '$lib/services/app-relay-service.svelte.js';
import {
  getTargetCommunityPubkeys,
  resolveCommunityPublishRelays
} from '$lib/helpers/community-publish-relays.js';

/**
 * NIP-52 splits one appointment across kind 31922 (all-day) and 31923
 * (timed), replaceable per kind:pubkey:d — see calendarTwinKey in
 * calendar-timing.js. The other kind for a given calendar kind.
 */
const CALENDAR_TWIN_KIND = { 31922: 31923, 31923: 31922 };

/**
 * Find the cross-kind twin of a calendar event already known to the local
 * EventStore, if any. A publisher that flips an appointment's kind under a
 * stable d-tag (e.g. an importer rewriting timed events as all-day ones)
 * leaves both coordinates live; `dedupeCalendarTwins` only hides the losing
 * one from lists, it does not delete it, so without this lookup that twin
 * resurfaces the moment the visible one is deleted.
 *
 * @param {string} pubkey
 * @param {number} kind
 * @param {string} dTag
 * @returns {import('nostr-tools').NostrEvent | undefined}
 */
function findCalendarTwin(pubkey, kind, dTag) {
  const twinKind = CALENDAR_TWIN_KIND[/** @type {31922 | 31923} */ (kind)];
  if (!twinKind) return undefined;
  return eventStore.getReplaceable(twinKind, pubkey, dTag);
}

/**
 * Delete a calendar event using NIP-09 deletion
 * Thin wrapper around deleteEvent() with calendar-specific validation
 * @param {any} event - The calendar event to delete (can be raw event or processed)
 * @param {any} activeUser - The active user with signer
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteCalendarEvent(event, activeUser) {
  // Calendar events are addressable and require a d-tag
  const dTag = event?.dTag || event?.tags?.find((/** @type {any[]} */ t) => t[0] === 'd')?.[1];
  if (!dTag) {
    return { success: false, error: 'Invalid calendar event: missing d-tag' };
  }

  const twin =
    event?.pubkey && event?.kind ? findCalendarTwin(event.pubkey, event.kind, dTag) : undefined;

  return deleteEvent(event, activeUser, twin ? { extraEvents: [twin] } : {});
}

/**
 * Delete any Nostr event using NIP-09 deletion (unified helper)
 * Automatically determines relay category from event kind
 * @param {any} event - The Nostr event to delete
 * @param {any} activeUser - The active user with signer
 * @param {{additionalRelays?: string[], extraEvents?: import('nostr-tools').NostrEvent[]}} [opts]
 *   - additionalRelays: extra relays the request must reach (e.g. a
 *   community's relays for a kind with no app category and no seen-relay
 *   provenance yet, such as a freshly published moderation label).
 *   - extraEvents: other events to fold into the SAME NIP-09 deletion (e.g. a
 *   calendar event's cross-kind twin) so one kind 5 covers every coordinate.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteEvent(event, activeUser, opts = {}) {
  if (!activeUser || !event) {
    return { success: false, error: 'Missing required parameters' };
  }

  const kind = event.kind;
  const pubkey = event.pubkey;

  if (!kind || !pubkey) {
    return { success: false, error: 'Invalid event data' };
  }

  // Verify ownership
  if (pubkey !== activeUser.pubkey) {
    return { success: false, error: 'You can only delete your own events' };
  }

  try {
    // Create EventFactory
    const factory = createAppEventFactory({
      signer: activeUser.signer
    });

    // Use factory.delete() - properly constructs NIP-09 deletion events
    const eventToDelete = event.originalEvent || event;
    const extraEvents = opts.extraEvents ?? [];

    // Folding extraEvents into the SAME factory.delete() call produces one
    // kind 5 with e/a/k tags for every event, instead of one deletion per
    // coordinate — fewer signatures, and relays see the whole intent at once.
    const deleteTemplate = await factory.delete([eventToDelete, ...extraEvents]);
    const signedDelete = await factory.sign(deleteTemplate);

    // Determine additional relays based on event kind
    const category = kindToAppRelayCategory(kind);
    const categoryRelays = category ? getAppRelaysForCategory(category) : [];

    // NIP-09: the deletion request must reach every relay that still holds the
    // original event, otherwise those relays keep serving it. Relay provenance
    // (seen-relays) captures where the event was actually fetched from — e.g. a
    // community relay an event was h-tagged to — which the author's NIP-65 write
    // relays alone would miss.
    const seenRelays = getSeenRelays(eventToDelete);
    const extraSeenRelays = extraEvents.flatMap((e) => Array.from(getSeenRelays(e) ?? []));
    // Seen-relays are absent for a freshly published or IDB-cached event; its
    // h tags still name the community relays it was published to.
    const communityRelays = await Promise.all(
      [eventToDelete, ...extraEvents].map((e) =>
        resolveCommunityPublishRelays(e.kind, getTargetCommunityPubkeys(e))
      )
    );
    const additionalRelays = [
      ...categoryRelays,
      ...(seenRelays ? Array.from(seenRelays) : []),
      ...extraSeenRelays,
      ...communityRelays.flat(),
      ...(opts.additionalRelays ?? [])
    ];

    // Not optimistic: a kind 5 in the EventStore's DeleteManager cannot be
    // taken back, and the deleted$ mirror drops the target from IDB. Applying
    // it before a relay accepted it would hide content that every relay still
    // serves — gone until the next reload, then back.
    const published = await publishEvent(signedDelete, [], { additionalRelays });
    if (!published.success) {
      return { success: false, error: 'No relay accepted the deletion' };
    }

    eventStore.add(signedDelete);
    // Persist the deletion to IDB so hydrateDeletions() replays it on the next
    // boot. The EventStore routes kind 5 to its DeleteManager and never emits it
    // on insert$, so the cache write pipeline misses it — without this the
    // deleted event is read back from cache and reappears across reloads.
    cacheDeletion(signedDelete);

    return { success: true };
  } catch (error) {
    console.error('Failed to delete event:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}
