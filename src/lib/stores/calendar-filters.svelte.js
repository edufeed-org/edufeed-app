/**
 * Calendar Filters Store - Svelte 5 Runes + RxJS Observables
 * Manages filter state for calendar views (relays, tags, search, follow lists)
 * Events are managed at component level using loader/model pattern
 */

import { BehaviorSubject } from 'rxjs';
import { SvelteSet } from 'svelte/reactivity';

/**
 * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
 */

class CalendarFiltersStore {
  // RxJS observable for selected calendar (single source of truth)
  selectedCalendar$ = new BehaviorSubject(/** @type {any} */ (null));

  // Reactive filter state using Svelte 5 runes
  selectedRelays = $state(/** @type {string[]} */ ([]));
  selectedTags = $state(/** @type {string[]} */ ([]));
  searchQuery = $state('');
  followLists = $state(
    /** @type {Array<{id: string, name: string, type: 'nip02' | 'nip51', description?: string, pubkeys: string[], count: number}>} */ ([])
  );
  selectedFollowListIds = $state(/** @type {string[]} */ ([]));
  selectedFeaturedAuthors = $state(/** @type {string[]} */ ([]));

  // Quick "people" toggle: 'off' (no toggle), 'follows' (use user's NIP-02
  // follows), 'featured' (use deployment-configured featured authors).
  /** @type {'off' | 'follows' | 'featured'} */
  onlyFollowsMode = $state('off');

  // Pool of pubkeys used when onlyFollowsMode === 'follows' (set when the
  // user's NIP-02 contact list is loaded).
  userFollowPubkeys = $state(/** @type {string[]} */ ([]));

  // Pool of pubkeys used when onlyFollowsMode === 'featured' (set from
  // runtimeConfig.calendar.featuredAuthors).
  featuredAuthorPubkeys = $state(/** @type {string[]} */ ([]));

  // Authors hidden via the "top publishers" quick filter (issue #28).
  // Their events are removed from the displayed set client-side.
  hiddenAuthorPubkeys = $state(/** @type {string[]} */ ([]));

  // Getter for current observable values (for convenience)
  get selectedCalendar() {
    return this.selectedCalendar$.value;
  }

  // Derived getter - ID is extracted from calendar object
  get selectedCalendarId() {
    return this.selectedCalendar$.value?.id || '';
  }

  // Actions for updating state

  /**
   * Set selected calendar
   * @param {any} calendar - Calendar object with id property
   */
  setSelectedCalendar(calendar) {
    console.log(
      '📅 CalendarFiltersStore: Setting selected calendar:',
      calendar?.id,
      calendar?.title
    );
    this.selectedCalendar$.next(calendar);
  }

  /**
   * Set selected relays for filtering
   * @param {string[]} relays - Array of relay URLs
   */
  setSelectedRelays(relays) {
    console.log('📅 CalendarFiltersStore: Setting selected relays:', relays);
    this.selectedRelays = relays;
  }

  /**
   * Clear selected relays (revert to default)
   */
  clearSelectedRelays() {
    console.log('📅 CalendarFiltersStore: Clearing selected relays');
    this.selectedRelays = [];
  }

  /**
   * Add a relay to the selected relays list
   * @param {string} relay - Relay URL to add
   */
  addRelay(relay) {
    if (!this.selectedRelays.includes(relay)) {
      console.log('📅 CalendarFiltersStore: Adding relay:', relay);
      this.selectedRelays = [...this.selectedRelays, relay];
    }
  }

  /**
   * Remove a relay from the selected relays list
   * @param {string} relay - Relay URL to remove
   */
  removeRelay(relay) {
    console.log('📅 CalendarFiltersStore: Removing relay:', relay);
    this.selectedRelays = this.selectedRelays.filter((r) => r !== relay);
  }

  /**
   * Set selected tags for filtering
   * @param {string[]} tags - Array of tag strings
   */
  setSelectedTags(tags) {
    console.log('📅 CalendarFiltersStore: Setting selected tags:', tags);
    this.selectedTags = tags;
  }

  /**
   * Clear selected tags (revert to showing all)
   */
  clearSelectedTags() {
    console.log('📅 CalendarFiltersStore: Clearing selected tags');
    this.selectedTags = [];
  }

  /**
   * Add a tag to the selected tags list
   * @param {string} tag - Tag to add
   */
  addTag(tag) {
    if (!this.selectedTags.includes(tag)) {
      console.log('📅 CalendarFiltersStore: Adding tag:', tag);
      this.selectedTags = [...this.selectedTags, tag];
    }
  }

  /**
   * Remove a tag from the selected tags list
   * @param {string} tag - Tag to remove
   */
  removeTag(tag) {
    console.log('📅 CalendarFiltersStore: Removing tag:', tag);
    this.selectedTags = this.selectedTags.filter((t) => t !== tag);
  }

  /**
   * Set search query for text filtering
   * @param {string} query - Search query string
   */
  setSearchQuery(query) {
    console.log('📅 CalendarFiltersStore: Setting search query:', query);
    this.searchQuery = query;
  }

  /**
   * Clear search query
   */
  clearSearchQuery() {
    console.log('📅 CalendarFiltersStore: Clearing search query');
    this.searchQuery = '';
  }

  /**
   * Set follow lists
   * @param {Array<{id: string, name: string, type: 'nip02' | 'nip51', description?: string, pubkeys: string[], count: number}>} lists - Array of follow lists
   */
  setFollowLists(lists) {
    console.log('👥 CalendarFiltersStore: Setting follow lists:', lists.length);
    this.followLists = lists;
  }

  /**
   * Clear follow lists
   */
  clearFollowLists() {
    console.log('👥 CalendarFiltersStore: Clearing follow lists');
    this.followLists = [];
  }

  /**
   * Set selected follow list IDs for filtering
   * @param {string[]} listIds - Array of follow list IDs
   */
  setSelectedFollowListIds(listIds) {
    console.log('👥 CalendarFiltersStore: Setting selected follow list IDs:', listIds);
    this.selectedFollowListIds = listIds;
  }

  /**
   * Clear selected follow list IDs (revert to showing all)
   */
  clearSelectedFollowListIds() {
    console.log('👥 CalendarFiltersStore: Clearing selected follow list IDs');
    this.selectedFollowListIds = [];
  }

  /**
   * Set featured-author pubkey filter (hex).
   * @param {string[]} pubkeys
   */
  setSelectedFeaturedAuthors(pubkeys) {
    this.selectedFeaturedAuthors = pubkeys;
  }

  /**
   * Clear featured-author filter.
   */
  clearSelectedFeaturedAuthors() {
    this.selectedFeaturedAuthors = [];
  }

  /**
   * Add one featured author (dedupes).
   * @param {string} pubkey
   */
  addFeaturedAuthor(pubkey) {
    if (!this.selectedFeaturedAuthors.includes(pubkey)) {
      this.selectedFeaturedAuthors = [...this.selectedFeaturedAuthors, pubkey];
    }
  }

  /**
   * Remove one featured author.
   * @param {string} pubkey
   */
  removeFeaturedAuthor(pubkey) {
    this.selectedFeaturedAuthors = this.selectedFeaturedAuthors.filter((p) => p !== pubkey);
  }

  /**
   * Set quick "people" toggle mode.
   * @param {'off' | 'follows' | 'featured'} mode
   */
  setOnlyFollowsMode(mode) {
    this.onlyFollowsMode = mode;
  }

  /**
   * Toggle an author on the hidden-publishers list.
   * @param {string} pubkey
   */
  toggleHiddenAuthor(pubkey) {
    if (this.hiddenAuthorPubkeys.includes(pubkey)) {
      this.hiddenAuthorPubkeys = this.hiddenAuthorPubkeys.filter((p) => p !== pubkey);
    } else {
      this.hiddenAuthorPubkeys = [...this.hiddenAuthorPubkeys, pubkey];
    }
  }

  /**
   * Clear all hidden publishers.
   */
  clearHiddenAuthors() {
    this.hiddenAuthorPubkeys = [];
  }

  /**
   * Set the pool of pubkeys representing the active user's NIP-02 follows.
   * Consumed by `getEffectiveAuthorPubkeys()` when mode === 'follows'.
   * @param {string[]} pubkeys
   */
  setUserFollowPubkeys(pubkeys) {
    this.userFollowPubkeys = pubkeys;
  }

  /**
   * Set the pool of deployment-configured featured author pubkeys.
   * Consumed by `getEffectiveAuthorPubkeys()` when mode === 'featured'.
   * @param {string[]} pubkeys
   */
  setFeaturedAuthorPubkeys(pubkeys) {
    this.featuredAuthorPubkeys = pubkeys;
  }

  /**
   * Get the deduplicated union of pubkeys across all "people" filter sources:
   *   - the active mode's pool (follows or featured),
   *   - selected NIP-51 list authors,
   *   - individually picked authors (selectedFeaturedAuthors).
   * Used by loaders/post-filters to scope events to the chosen people.
   * @returns {string[]} Deduplicated array of pubkeys
   */
  getEffectiveAuthorPubkeys() {
    const out = new SvelteSet();
    if (this.onlyFollowsMode === 'follows') {
      this.userFollowPubkeys.forEach((p) => out.add(p));
    } else if (this.onlyFollowsMode === 'featured') {
      this.featuredAuthorPubkeys.forEach((p) => out.add(p));
    }
    this.getSelectedAuthors().forEach((p) => out.add(p));
    this.selectedFeaturedAuthors.forEach((p) => out.add(p));
    return Array.from(out);
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
    console.log(
      `👥 CalendarFiltersStore: Got ${uniquePubkeys.length} unique authors from ${selectedLists.length} follow lists`
    );

    return uniquePubkeys;
  }

  /**
   * Reset all filter state
   */
  reset() {
    console.log('📅 CalendarFiltersStore: Resetting all filter state');
    this.selectedCalendar$.next(null);
    this.selectedRelays = [];
    this.selectedTags = [];
    this.searchQuery = '';
    this.followLists = [];
    this.selectedFollowListIds = [];
    this.selectedFeaturedAuthors = [];
    this.onlyFollowsMode = 'off';
    this.userFollowPubkeys = [];
    this.featuredAuthorPubkeys = [];
    this.hiddenAuthorPubkeys = [];
  }
}

// Export singleton instance
export const calendarFilters = new CalendarFiltersStore();

// Export for debugging in development
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.calendarFilters = calendarFilters;
}
