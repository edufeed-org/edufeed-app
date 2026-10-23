/**
 * Calendar Event RSVPs Store Hook
 * Composable hook for loading raw RSVP events for calendar events
 * Uses applesauce's built-in CalendarEventRSVPsModel for reactive updates
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { CalendarEventRSVPsModel } from 'applesauce-common/models';
import { calendarEventRsvpLoader } from '$lib/loaders/rsvp.js';

/**
 * Create a composable RSVP data loader for a calendar event
 * Returns raw RSVP events - components should handle transformation/grouping
 *
 * @param {any} calendarEvent - The calendar event object
 * @returns {{
 *   rsvps: any[],
 *   loading: boolean
 * }}
 */
export function useCalendarEventRsvps(calendarEvent) {
  // Reactive state
  /** @type {any[]} */
  let rsvps = $state([]);
  let loading = $state(true);

  // Subscriptions (plain let - not reactive to avoid infinite loops)
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSubscription;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSubscription;

  // Load RSVPs when component mounts
  $effect(() => {
    if (!calendarEvent) {
      loading = false;
      return;
    }

    loading = true;

    // Step 1: Subscribe to loader (continuously fetches RSVPs from relays → EventStore)
    loaderSubscription = calendarEventRsvpLoader(calendarEvent).subscribe({
      // Loader handles fetching, we just need the subscription alive
      next: () => {
        // Loader emission - RSVPs are being added to eventStore
      },
      error: (/** @type {any} */ err) => {
        console.error('Error loading RSVPs from relays:', err);
      }
    });

    // Step 2: Subscribe to applesauce's CalendarEventRSVPsModel (reactively watches EventStore)
    modelSubscription = eventStore.model(CalendarEventRSVPsModel, calendarEvent).subscribe({
      next: (events) => {
        // Return raw RSVP events - let components handle transformation
        rsvps = events;
        loading = false;
      },
      error: (/** @type {any} */ err) => {
        console.error('Error processing RSVP model:', err);
        loading = false;
      }
    });

    // Cleanup both subscriptions
    return () => {
      if (loaderSubscription) {
        loaderSubscription.unsubscribe();
      }
      if (modelSubscription) {
        modelSubscription.unsubscribe();
      }
    };
  });

  return {
    get rsvps() {
      return rsvps;
    },
    get loading() {
      return loading;
    }
  };
}
