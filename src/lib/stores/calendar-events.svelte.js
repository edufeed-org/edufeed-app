/**
 * Calendar Events Store - Svelte 5 Runes + RxJS Observables
 * Centralized reactive state management for calendar events
 * Provides better reactivity and component communication
 */
import { SvelteSet } from 'svelte/reactivity';
import { BehaviorSubject } from 'rxjs';
import { groupEventsByDate } from '$lib/helpers/calendar.js';

export let loading = $state({
  loading: false
});

export let cEvents = $state({
  events: []
});

/**
 * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
 */

class CalendarStore {
  // RxJS observable for selected calendar (single source of truth)
  selectedCalendar$ = new BehaviorSubject(/** @type {any} */ (null));

  // Reactive state using Svelte 5 runes
  events = $state(/** @type {CalendarEvent[]} */ ([]));
  loading = $state(false);
  error = $state(/** @type {string | null} */ (null));
  missingEvents = $state(/** @type {Array<{addressRef: string, reason?: string}>} */ ([]));
  selectedRelays = $state(/** @type {string[]} */ ([]));
  selectedTags = $state(/** @type {string[]} */ ([]));
  searchQuery = $state('');
  followLists = $state(
    /** @type {Array<{id: string, name: string, type: 'nip02' | 'nip51', description?: string, pubkeys: string[], count: number}>} */ ([])
  );
  selectedFollowListIds = $state(/** @type {string[]} */ ([]));

  // Derived reactive state
  groupedEvents = $derived(groupEventsByDate(this.events));
  eventCount = $derived(this.events.length);
  hasEvents = $derived(this.events.length > 0);
  hasMissingEvents = $derived(this.missingEvents.length > 0);
  missingEventsCount = $derived(this.missingEvents.length);

  // Getters for current observable values (for convenience)
  get selectedCalendar() {
    return this.selectedCalendar$.value;
  }

  // Derived getter - ID is extracted from calendar object
  get selectedCalendarId() {
    return this.selectedCalendar$.value?.id || '';
  }

  // Actions for updating state

  /**
   * Set the events array
   * @param {CalendarEvent[]} newEvents
   */
  setEvents(newEvents) {
    this.events = newEvents;
  }

  /**
   * Clear all events
   */
  clearEvents() {
    this.events = [];
  }

  /**
   * Set loading state
   * @param {boolean} isLoading
   */
  setLoading(isLoading) {
    this.loading = isLoading;
  }

  /**
   * Set error state
   * @param {string | null} errorMessage
   */
  setError(errorMessage) {
    this.error = errorMessage;
  }

  /**
   * Set selected calendar
   * @param {any} calendar - Calendar object with id property
   */
  setSelectedCalendar(calendar) {
    this.selectedCalendar$.next(calendar);
  }

  /**
   * Set selected relays for filtering
   * @param {string[]} relays - Array of relay URLs
   */
  setSelectedRelays(relays) {
    this.selectedRelays = relays;
  }

  /**
   * Clear selected relays (revert to default)
   */
  clearSelectedRelays() {
    this.selectedRelays = [];
  }

  /**
   * Add a relay to the selected relays list
   * @param {string} relay - Relay URL to add
   */
  addRelay(relay) {
    if (!this.selectedRelays.includes(relay)) {
      this.selectedRelays = [...this.selectedRelays, relay];
    }
  }

  /**
   * Remove a relay from the selected relays list
   * @param {string} relay - Relay URL to remove
   */
  removeRelay(relay) {
    this.selectedRelays = this.selectedRelays.filter((r) => r !== relay);
  }

  /**
   * Set selected tags for filtering
   * @param {string[]} tags - Array of tag strings
   */
  setSelectedTags(tags) {
    this.selectedTags = tags;
  }

  /**
   * Clear selected tags (revert to showing all)
   */
  clearSelectedTags() {
    this.selectedTags = [];
  }

  /**
   * Add a tag to the selected tags list
   * @param {string} tag - Tag to add
   */
  addTag(tag) {
    if (!this.selectedTags.includes(tag)) {
      this.selectedTags = [...this.selectedTags, tag];
    }
  }

  /**
   * Remove a tag from the selected tags list
   * @param {string} tag - Tag to remove
   */
  removeTag(tag) {
    this.selectedTags = this.selectedTags.filter((t) => t !== tag);
  }

  /**
   * Set search query for text filtering
   * @param {string} query - Search query string
   */
  setSearchQuery(query) {
    this.searchQuery = query;
  }

  /**
   * Clear search query
   */
  clearSearchQuery() {
    this.searchQuery = '';
  }

  /**
   * Set follow lists
   * @param {Array<{id: string, name: string, type: 'nip02' | 'nip51', description?: string, pubkeys: string[], count: number}>} lists - Array of follow lists
   */
  setFollowLists(lists) {
    this.followLists = lists;
  }

  /**
   * Clear follow lists
   */
  clearFollowLists() {
    this.followLists = [];
  }

  /**
   * Set selected follow list IDs for filtering
   * @param {string[]} listIds - Array of follow list IDs
   */
  setSelectedFollowListIds(listIds) {
    this.selectedFollowListIds = listIds;
  }

  /**
   * Clear selected follow list IDs (revert to showing all)
   */
  clearSelectedFollowListIds() {
    this.selectedFollowListIds = [];
  }

  /**
   * Get unique author pubkeys from selected follow lists
   * @returns {string[]} Array of unique author pubkeys
   */
  getSelectedAuthors() {
    if (this.selectedFollowListIds.length === 0) {
      return [];
    }

    const selectedLists = this.followLists.filter((list) =>
      this.selectedFollowListIds.includes(list.id)
    );

    // Collect all pubkeys and deduplicate
    const pubkeysSet = new SvelteSet();
    selectedLists.forEach((list) => {
      list.pubkeys.forEach((pubkey) => pubkeysSet.add(pubkey));
    });

    const uniquePubkeys = Array.from(pubkeysSet);

    return uniquePubkeys;
  }

  /**
   * Reset all state
   */
  reset() {
    this.events = [];
    this.loading = false;
    this.error = null;
    this.selectedCalendar$.next(null);
    this.missingEvents = [];
    this.selectedRelays = [];
    this.selectedTags = [];
    this.searchQuery = '';
    this.followLists = [];
    this.selectedFollowListIds = [];
  }
}

// Export singleton instance
export const calendarStore = new CalendarStore();

// Export for debugging in development
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.calendarEventsStore = calendarStore;
}
