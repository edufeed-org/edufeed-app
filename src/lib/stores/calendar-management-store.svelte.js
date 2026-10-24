/**
 * Calendar Management Store
 * Manages user calendars (NIP-52 kind 31924) with reactive state.
 * Uses Loader+Model pattern: loaders feed EventStore, TimelineModel provides
 * reactive data with automatic deletion filtering.
 * CRUD operations use applesauce ActionRunner for sustainable event modification.
 */

import { debounceTime } from 'rxjs';
import { TimelineModel } from 'applesauce-core/models';
import { getTagValue } from 'applesauce-core/helpers';
import { userCalendarLoader } from '$lib/loaders/calendar.js';
import { userDeletionLoader } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCalendarEventTitle } from 'applesauce-common/helpers';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { AddEventToCalendar, RemoveEventFromCalendar } from 'applesauce-actions/actions';

/**
 * @typedef {Object} Calendar
 * @property {string} id - Event ID
 * @property {string} pubkey - Calendar owner pubkey
 * @property {number} kind - Event kind (31924)
 * @property {string} title - Calendar title
 * @property {string} description - Calendar description
 * @property {string} dTag - Unique identifier (d-tag)
 * @property {string[]} eventReferences - Array of event references (a-tags)
 * @property {number} createdAt - Creation timestamp
 * @property {import('nostr-tools').Event} originalEvent - Raw Nostr event
 */

/**
 * @typedef {Object} CalendarManagementStore
 * @property {Calendar[]} calendars - Array of user's calendars
 * @property {boolean} loading - Loading state
 * @property {string | null} error - Error message
 * @property {() => Promise<void>} refresh - Refresh calendars
 * @property {(calendarId: string, event: any) => Promise<boolean>} addEventToCalendar - Add event to calendar
 * @property {(calendarId: string, event: any) => Promise<boolean>} removeEventFromCalendar - Remove event from calendar
 * @property {() => void} destroy - Cleanup subscriptions
 */

/**
 * Create a calendar management store for a specific user.
 * Follows Loader+Model pattern (see all-communities.svelte.js):
 * 1. Loader fetches kind 31924 events → EventStore
 * 2. Deletion loader fetches kind 5 → EventStore (for deletion awareness)
 * 3. TimelineModel subscribes to EventStore → reactive, deletion-filtered data
 * 4. Safety timeout ensures loading never sticks
 *
 * @param {string} userPubkey - User's public key
 * @returns {CalendarManagementStore} Calendar management store
 */
export function createCalendarManagementStore(userPubkey) {
  let calendars = $state(/** @type {Calendar[]} */ ([]));
  let loading = $state(true);
  let error = $state(/** @type {string | null} */ (null));

  // Plain let for subscriptions (Pattern A — never use $state for subscriptions)
  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let deletionSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let safetyTimeout;

  function initialize() {
    loading = true;
    error = null;

    // 1. Loader: fetch kind 31924 → EventStore
    const loader = userCalendarLoader(userPubkey);
    loaderSub = loader().subscribe({
      complete: () => {
        loading = false;
      },
      error: (/** @type {any} */ err) => {
        error = err?.message || 'Failed to load calendars';
        loading = false;
      }
    });

    // 2. Deletion loader: fetch kind 5 → EventStore
    const delLoader = userDeletionLoader(userPubkey);
    deletionSub = delLoader().subscribe();

    // 3. TimelineModel: reactive query with auto-deletion filtering
    modelSub = eventStore
      .model(TimelineModel, {
        kinds: [31924],
        authors: [userPubkey]
      })
      .pipe(debounceTime(100))
      .subscribe({
        next: (events) => {
          calendars = /** @type {import('nostr-tools').Event[]} */ (events || []).map(
            convertNDKEventToCalendar
          );
          loading = false;
        }
      });

    // 4. Safety timeout (same pattern as all-communities.svelte.js)
    safetyTimeout = setTimeout(() => {
      loading = false;
    }, 5_000);
  }

  initialize();

  /**
   * Refresh calendars by tearing down and re-initializing
   */
  async function refresh() {
    destroy();
    calendars = [];
    initialize();
  }

  /**
   * Add an event to a calendar using applesauce ActionRunner.
   * @param {string} calendarId - Calendar ID to add the event to
   * @param {import('nostr-tools').Event} event - Calendar event (kind 31922/31923) to add
   * @returns {Promise<boolean>} Success status
   */
  async function addEventToCalendar(calendarId, event) {
    try {
      const calendar = calendars.find((c) => c.id === calendarId);
      if (!calendar) throw new Error('Calendar not found');

      await actionRunner.run(AddEventToCalendar, calendar.originalEvent, event);
      return true;
    } catch (err) {
      console.error('Error adding event to calendar:', err);
      error = err instanceof Error ? err.message : 'Failed to add event to calendar';
      return false;
    }
  }

  /**
   * Remove an event from a calendar using applesauce ActionRunner.
   * @param {string} calendarId - Calendar ID to remove the event from
   * @param {import('nostr-tools').Event} event - Calendar event (kind 31922/31923) to remove
   * @returns {Promise<boolean>} Success status
   */
  async function removeEventFromCalendar(calendarId, event) {
    try {
      const calendar = calendars.find((c) => c.id === calendarId);
      if (!calendar) throw new Error('Calendar not found');

      await actionRunner.run(RemoveEventFromCalendar, calendar.originalEvent, event);
      return true;
    } catch (err) {
      console.error('Error removing event from calendar:', err);
      error = err instanceof Error ? err.message : 'Failed to remove event from calendar';
      return false;
    }
  }

  function destroy() {
    loaderSub?.unsubscribe();
    deletionSub?.unsubscribe();
    modelSub?.unsubscribe();
    if (safetyTimeout) clearTimeout(safetyTimeout);
  }

  return {
    get calendars() {
      return calendars;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    refresh,
    addEventToCalendar,
    removeEventFromCalendar,
    destroy
  };
}

/**
 * Convert NDK event to Calendar object
 * @param {any} ndkEvent - NDK event
 * @returns {Calendar} Calendar object
 */
function convertNDKEventToCalendar(ndkEvent) {
  return {
    id: ndkEvent.id || '',
    pubkey: ndkEvent.pubkey || '',
    kind: ndkEvent.kind,
    title: getCalendarEventTitle(ndkEvent) || 'Untitled Calendar',
    description: ndkEvent.content || '',
    dTag: getTagValue(ndkEvent, 'd') || '',
    eventReferences: (ndkEvent.tags || [])
      .filter((/** @type {any[]} */ t) => t[0] === 'a' && t[1])
      .map((/** @type {any[]} */ t) => t[1]),
    createdAt: ndkEvent.created_at || 0,
    originalEvent: ndkEvent
  };
}

/**
 * Global calendar management store instances (plain Map — Pattern C: never use
 * SvelteMap for internal bookkeeping that doesn't drive UI rendering)
 * @type {Map<string, CalendarManagementStore>}
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const calendarManagementStores = new Map();

/**
 * Get or create a calendar management store for a user
 * @param {string} userPubkey - User's public key
 * @returns {CalendarManagementStore} Calendar management store instance
 */
export function useCalendarManagement(userPubkey) {
  if (!calendarManagementStores.has(userPubkey)) {
    calendarManagementStores.set(userPubkey, createCalendarManagementStore(userPubkey));
  }
  return /** @type {CalendarManagementStore} */ (calendarManagementStores.get(userPubkey));
}

/**
 * Cleanup all calendar management stores
 */
export function cleanupCalendarManagementStores() {
  calendarManagementStores.forEach((store) => {
    if (store && typeof store.destroy === 'function') {
      store.destroy();
    }
  });
  calendarManagementStores.clear();
}
