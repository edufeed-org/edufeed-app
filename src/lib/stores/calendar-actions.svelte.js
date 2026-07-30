/**
 * Calendar Actions Store
 * Actions for creating and managing calendar events with applesauce integration
 */
import { SvelteMap } from 'svelte/reactivity';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { manager } from '$lib/stores/accounts.svelte';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { unixNow } from 'applesauce-core/helpers/time';
import {
  validateEventForm,
  convertFormDataToEvent,
  buildCalendarEventTags
} from '../helpers/calendar.js';
import { calendarStore } from './calendar-events.svelte.js';
import { getCalendarEventMetadata } from '../helpers/eventUtils.js';
import {
  publishEvent,
  publishEventOptimistic,
  buildATagWithHint,
  buildETagWithHint,
  buildPTagsWithHints
} from '$lib/services/publish-service.js';

/**
 * @typedef {import('../types/calendar.js').CalendarEvent} CalendarEvent
 * @typedef {import('../types/calendar.js').EventFormData} EventFormData
 * @typedef {import('../types/calendar.js').CalendarActions} CalendarActions
 */

/**
 * Create calendar actions for a specific community
 * @param {string} _communityPubkey - Community public key
 * @returns {CalendarActions} Calendar actions object
 */
export function createCalendarActions(_communityPubkey) {
  return {
    /**
     * Create a new calendar event
     * @param {EventFormData} formData - Event form data
     * @param {string | string[]} communityPubkeys - Target community public key(s)
     * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community definition event (kind 10222) for relay routing
     * @returns {Promise<any>}
     */
    async createEvent(formData, communityPubkeys, communityEvent = null) {
      // Validate form data
      const validationErrors = validateEventForm(formData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Get current account from manager
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to create events.');
      }

      // Normalize to array
      const pubkeys = Array.isArray(communityPubkeys)
        ? communityPubkeys.filter(Boolean)
        : [communityPubkeys].filter(Boolean);

      // Convert form data to event object (uses first pubkey for backward compat)
      const eventData = convertFormDataToEvent(formData, pubkeys[0] || '');

      try {
        // Generate unique d-tag for the calendar event
        const dTag = `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create the calendar event using EventFactory
        const eventFactory = createAppEventFactory();

        // Build NIP-52 compliant tags with all community h-tags
        const tags = buildCalendarEventTags(
          formData,
          eventData,
          dTag,
          pubkeys.length > 0 ? pubkeys : undefined
        );

        // Build and sign the calendar event
        const eventTemplate = await eventFactory.build({
          kind: eventData.kind || 31922,
          content: eventData.summary || '',
          tags: tags
        });

        const calendarEvent = await currentAccount.signEvent(eventTemplate);

        // Add dTag property to the event object for calendar management
        const eventWithDTag = {
          ...calendarEvent,
          dTag: dTag
        };

        // Transform the raw Nostr event to CalendarEvent format for immediate UI display
        const transformedEvent = getCalendarEventMetadata(eventWithDTag);

        // Add the transformed event to the calendar store for immediate UI update
        calendarStore.setEvents([...calendarStore.events, transformedEvent]);

        // Publish optimistically in background (returns immediately).
        // Participants are tagged pubkeys: outbox model also targets their read relays.
        const participantPubkeys = (formData.participants || [])
          .map((/** @type {{pubkey: string}} */ p) => p.pubkey)
          .filter(Boolean);
        publishEventOptimistic(calendarEvent, participantPubkeys, { communityEvent });

        // Return the created event so caller can handle sharing/adding to calendars
        return eventWithDTag;
      } catch (error) {
        console.error('Error creating calendar event:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create calendar event: ${errorMessage}`);
      }
    },

    /**
     * Update an existing calendar event
     * @param {EventFormData} formData - Event form data
     * @param {any} existingEvent - Existing raw Nostr event to update
     * @param {import('nostr-tools').NostrEvent | null} [communityEvent] - Optional community definition event (kind 10222) for relay routing
     * @param {string[] | null} [communityPubkeys] - New community h-tag set; null preserves the existing h-tags unchanged
     * @returns {Promise<any>}
     */
    async updateEvent(formData, existingEvent, communityEvent = null, communityPubkeys = null) {
      // Validate form data
      const validationErrors = validateEventForm(formData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Get current account
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to update events.');
      }

      // Extract the original d-tag from the existing event
      const dTag = existingEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
      if (!dTag) {
        throw new Error('Cannot update event: missing d-tag. Event may not be replaceable.');
      }

      // Community targeting: an explicit selection replaces the h-tag set;
      // otherwise every existing h-tag is preserved (an event can be shared
      // with several communities — dropping all but the first un-shares it).
      const hTags =
        communityPubkeys ??
        existingEvent.tags
          .filter((/** @type {string[]} */ t) => t[0] === 'h' && t[1])
          .map((/** @type {string[]} */ t) => t[1]);

      // Verify the user owns this event
      if (existingEvent.pubkey !== currentAccount.pubkey) {
        throw new Error('Cannot update event: you do not own this event.');
      }

      try {
        // Convert form data to event object
        const eventData = convertFormDataToEvent(formData, existingEvent.pubkey);

        // An update MUST NOT change the kind.
        //
        // NIP-52 splits calendar events by kind: 31922 is date-based (all-day,
        // `start` is YYYY-MM-DD) and 31923 is time-based (`start` is a unix
        // timestamp, plus a required `D` tag). Toggling all-day therefore
        // forces a different kind — there is no legal way to express an
        // all-day event as a 31923, so this cannot be fixed by keeping the
        // existing kind and clearing the time fields.
        //
        // But a replaceable event is addressed by (kind, pubkey, d-tag), so a
        // new kind is a NEW COORDINATE: the original is not replaced, both
        // events stay live, and the naddr already in the URL still resolves to
        // the pre-edit one. The user sees a save that silently did nothing —
        // the same symptom as #62, which no cache fix can touch because the
        // edit genuinely went somewhere else.
        //
        // Delete-and-recreate is not a safe alternative: NIP-52 calendars
        // (kind 31924) reference their events by `a` = <kind>:<pubkey>:<d>,
        // and that list is held by the CALENDAR owner, who need not be the
        // person editing — this client cannot re-point references it cannot
        // sign. The NIP also says explicitly that it "is intentionally not
        // defining what happens if a calendar event changes after an RSVP is
        // submitted", so there is no spec-blessed migration to implement.
        //
        // Refusing is the only option that cannot corrupt anything, and it
        // takes nothing away that works today. (#65)
        if (eventData.kind && eventData.kind !== existingEvent.kind) {
          throw new Error(
            'Cannot change an event between all-day and timed after it has been created. ' +
              'The two use different NIP-52 kinds, so the change would create a second ' +
              'event instead of replacing this one. Delete this event and create a new one instead.'
          );
        }

        // Create the calendar event using EventFactory with the SAME d-tag
        const eventFactory = createAppEventFactory();

        // Build NIP-52 compliant tags (reuses original d-tag for replacement)
        const tags = buildCalendarEventTags(formData, eventData, dTag, hTags);

        // Build and sign the updated calendar event.
        //
        // created_at MUST be strictly greater than the event being replaced.
        // A replacement that lands in the same wall-clock second as its
        // predecessor is silently dropped by three independent layers, each
        // with a different tie-break:
        //   - relays (NIP-01): on equal created_at the LOWER id wins — a coin
        //     flip, so the edit is lost about half the time;
        //   - applesauce's EventStore: same rule, lower id wins
        //     (event-store.js `incomingBeatsWinner`);
        //   - nostr-idb: strict `event.created_at > existing` (database/
        //     insert.js), so on a tie the IDB write is ALWAYS rejected — and
        //     since the cache is the first step of the address loader and a
        //     cache hit ends the sequence, no relay ever corrects it.
        // Only the relay layer is a coin flip; the cache is deterministically
        // stale, which is why a same-second edit reads as "the save did
        // nothing" even when the relay accepted it. Reachable by a user
        // editing straight after creating, and by two tabs. (#62)
        const eventTemplate = await eventFactory.build({
          kind: eventData.kind || existingEvent.kind,
          content: eventData.summary || '',
          tags: tags,
          created_at: Math.max(unixNow(), (existingEvent.created_at ?? 0) + 1)
        });

        const updatedEvent = await currentAccount.signEvent(eventTemplate);

        // Add dTag property to the event object
        const eventWithDTag = {
          ...updatedEvent,
          dTag: dTag
        };

        // Transform the raw Nostr event to CalendarEvent format for immediate UI display
        const transformedEvent = getCalendarEventMetadata(eventWithDTag);

        // Update the event in the calendar store immediately
        const currentEvents = calendarStore.events;
        const updatedEvents = currentEvents.map((evt) =>
          evt.id === existingEvent.id ? transformedEvent : evt
        );
        calendarStore.setEvents(updatedEvents);

        // Await publish for updates to ensure event is saved before returning
        // Unlike creation which navigates away, updates reload the same page
        // and need the updated event to be available immediately
        const participantPubkeys = (formData.participants || [])
          .map((/** @type {{pubkey: string}} */ p) => p.pubkey)
          .filter(Boolean);
        const publishResult = await publishEvent(updatedEvent, participantPubkeys, {
          communityEvent
        });

        // The detail page reads through addressLoader, whose FIRST step is the
        // IndexedDB cache — and a cache hit ends applesauce's loading sequence
        // before any relay is queried. publishEvent, unlike
        // publishEventOptimistic, never touches the EventStore, and the cache
        // is fed from eventStore.insert$. Without this add the pre-edit version
        // stays cached and every reload renders the OLD event even though the
        // relay holds only the new one. Updating calendarStore above is not
        // enough: that is the list view, not the detail page's read path. (#62)
        //
        // Gated on success for the same reason publishEventOptimistic removes
        // the event when no relay accepts it — the cache must not outlive a
        // publish that never landed.
        //
        // Best-effort: eventStore.add validates the event and throws on a
        // malformed one. The publish has already landed at this point, so a
        // cache-write failure must not be reported to the user as a failed
        // update — it degrades to the stale-read behaviour, matching the
        // "cache is ADDITIVE" contract in stores/event-cache.svelte.js.
        if (publishResult?.success) {
          try {
            eventStore.add(updatedEvent);
          } catch (cacheError) {
            console.warn('[calendar] updated event not added to EventStore', cacheError);
          }
        }

        // Return the updated event
        return eventWithDTag;
      } catch (error) {
        console.error('Error updating calendar event:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to update calendar event: ${errorMessage}`);
      }
    },

    /**
     * Delete a calendar event
     * @param {string} eventId - Event ID to delete
     * @returns {Promise<void>}
     */
    async deleteEvent(eventId) {
      // Get current account
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to delete events.');
      }

      try {
        // Create a deletion event (kind 5) with relay hint for discoverability
        const eventFactory = createAppEventFactory();
        const eTagWithHint = await buildETagWithHint(eventId, currentAccount.pubkey);

        const eventTemplate = await eventFactory.build({
          kind: 5,
          content: '',
          tags: [eTagWithHint]
        });

        // Sign and publish the deletion event
        const deletionEvent = await currentAccount.signEvent(eventTemplate);
        await publishEvent(deletionEvent, []);
      } catch (error) {
        console.error('Error deleting calendar event:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to delete calendar event: ${errorMessage}`);
      }
    },

    /**
     * Create a new calendar
     * @param {string} title - Calendar title
     * @param {string} [description=''] - Calendar description
     * @returns {Promise<any>} Created calendar event object
     */
    async createCalendar(title, description = '') {
      // Validate inputs
      if (!title.trim()) {
        throw new Error('Calendar title is required');
      }

      // Get current account from manager
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to create calendars.');
      }

      try {
        // Generate unique d-tag for the calendar
        const dTag = `calendar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create the calendar event using EventFactory (NIP-52 kind 31924)
        const eventFactory = createAppEventFactory();

        // Build calendar event template
        const eventTemplate = await eventFactory.build({
          kind: 31924,
          content: description,
          tags: [
            ['d', dTag],
            ['title', title.trim()]
          ]
        });

        // Sign and publish the calendar event
        const calendarEvent = await currentAccount.signEvent(eventTemplate);
        await publishEvent(calendarEvent, []);

        return calendarEvent;
      } catch (error) {
        console.error('Error creating calendar:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create calendar: ${errorMessage}`);
      }
    },

    /**
     * Create or update an RSVP for a calendar event
     * @param {any} calendarEvent - Calendar event to RSVP to
     * @param {'accepted' | 'declined' | 'tentative'} status - RSVP status
     * @param {string} [content=''] - Optional RSVP message/note
     * @param {'free' | 'busy'} [freeBusy] - Optional free/busy status (ignored if declined)
     * @returns {Promise<any>} Created RSVP event
     */
    async createRsvp(calendarEvent, status, content = '', freeBusy) {
      // Validate status
      if (!['accepted', 'declined', 'tentative'].includes(status)) {
        throw new Error('Invalid RSVP status. Must be accepted, declined, or tentative');
      }

      // Get current account
      const currentAccount = manager.active;
      if (!currentAccount) {
        throw new Error('No account selected. Please log in to RSVP.');
      }

      try {
        // Extract event coordinates for the 'a' tag
        const eventKind = calendarEvent.kind;
        const eventPubkey = calendarEvent.pubkey;
        const dTag = calendarEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];

        if (!dTag) {
          throw new Error('Cannot RSVP: calendar event missing d-tag');
        }

        // Build event coordinate (NIP-33 format)
        const eventCoordinate = `${eventKind}:${eventPubkey}:${dTag}`;

        // Generate unique d-tag for the RSVP (allows user to update their RSVP)
        const rsvpDTag = `rsvp-${eventCoordinate}`;

        // Create the RSVP event using EventFactory (NIP-52 kind 31925)
        const eventFactory = createAppEventFactory();

        // Build RSVP tags according to NIP-52 with relay hints for discoverability
        const aTagWithHint = await buildATagWithHint(eventCoordinate);
        const tags = [
          ['d', rsvpDTag], // Unique identifier (same for updates)
          aTagWithHint, // Required: reference to calendar event with relay hint
          ['status', status] // Required: accepted/declined/tentative
        ];

        // Add optional event ID reference with relay hint
        if (calendarEvent.id) {
          const eTagWithHint = await buildETagWithHint(calendarEvent.id, eventPubkey);
          tags.push(eTagWithHint);
        }

        // Add optional free/busy status (ignored if declined)
        if (freeBusy && status !== 'declined') {
          tags.push(['fb', freeBusy]);
        }

        // Add optional reference to event author with relay hint
        const pTagsWithHints = await buildPTagsWithHints([eventPubkey]);
        tags.push(pTagsWithHints[0]);

        // Build and sign the RSVP event
        const eventTemplate = await eventFactory.build({
          kind: 31925,
          content: content,
          tags: tags
        });

        const rsvpEvent = await currentAccount.signEvent(eventTemplate);
        // Optimistic: adds to EventStore immediately, publishes in background.
        // Include event author in tagged pubkeys for outbox routing.
        publishEventOptimistic(rsvpEvent, [eventPubkey]);

        return rsvpEvent;
      } catch (error) {
        console.error('Error creating RSVP:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create RSVP: ${errorMessage}`);
      }
    },

    /**
     * Load events for a community (delegated to calendar events store)
     * @param {string} _targetCommunityPubkey - Community public key
     * @returns {Promise<CalendarEvent[]>}
     */
    async loadEvents(_targetCommunityPubkey) {
      // This method is primarily handled by the calendar events store
      // We return an empty array here as the actual loading is reactive
      return [];
    }
  };
}

/**
 * Global calendar actions store instances
 * @type {SvelteMap<string, CalendarActions>}
 */
const calendarActionsStores = new SvelteMap();

/**
 * Get or create calendar actions for a community
 * @param {string} communityPubkey - Community public key
 * @returns {CalendarActions} Calendar actions instance
 */
export function useCalendarActions(communityPubkey) {
  if (!calendarActionsStores.has(communityPubkey)) {
    calendarActionsStores.set(communityPubkey, createCalendarActions(communityPubkey));
  }
  return /** @type {CalendarActions} */ (calendarActionsStores.get(communityPubkey));
}

/**
 * Cleanup all calendar actions stores
 */
export function cleanupCalendarActionsStores() {
  calendarActionsStores.clear();
}
