/**
 * Contacts Store using Svelte 5 runes
 * Manages user's contact list (kind 3 follows) globally across the app
 *
 * Uses applesauce's built-in ContactsModel (returns ProfilePointer[]) instead of
 * a custom model with combineLatest. Profiles are looked up synchronously from
 * EventStore at search time, so contacts appear as soon as kind 3 loads —
 * missing profiles don't block the list.
 */

import { eventStore, pool } from './nostr-infrastructure.svelte.js';
import { createContactListLoader } from '$lib/loaders/contact-list-loader.js';
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { ContactsModel } from 'applesauce-core/models';
import { getProfileContent } from 'applesauce-core/helpers';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
import { timedPool } from '$lib/loaders/base.js';
import { profileLoader } from '$lib/loaders/profile.js';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * @typedef {Object} EnrichedContact
 * @property {string} pubkey - Contact's public key
 * @property {string|null} name - Profile name
 * @property {string|null} display_name - Display name
 * @property {string|null} picture - Profile picture URL
 * @property {string|null} nip05 - NIP-05 identifier
 * @property {string|null} about - Profile about/bio
 */

/** @type {string[]} */
let followedPubkeys = $state([]);
let isLoading = $state(false);
let isLoaded = $state(false);
let mailboxLoadStarted = false;
/** @type {import('rxjs').Subscription[]} */
let activeSubscriptions = [];

export const contactsStore = {
  get contacts() {
    return followedPubkeys;
  },
  get isLoading() {
    return isLoading;
  },
  get isLoaded() {
    return isLoaded;
  },

  /**
   * Load contacts for the authenticated user
   * @param {string} userPubkey - User's public key
   */
  async loadContacts(userPubkey) {
    if (!userPubkey || isLoading) return;

    isLoading = true;
    isLoaded = false;
    followedPubkeys = [];

    // Clean up any existing subscriptions
    this.clear();

    try {
      // Get user's write relays (outbox model)
      const relays = await getWriteRelays(userPubkey);

      // Step 1: Start background loader to fetch kind 3 event
      const loaderFactory = createContactListLoader(pool, relays, eventStore, userPubkey);
      const loaderSubscription = loaderFactory()().subscribe({
        error: (/** @type {any} */ error) => {
          console.error('Error loading contact list:', error);
        }
      });
      activeSubscriptions.push(loaderSubscription);

      // Step 2: Use applesauce ContactsModel — emits ProfilePointer[] immediately
      // (no combineLatest blocking on missing profiles)
      // Also loads profiles for each contact so they're available at search time.
      const modelSubscription = eventStore.model(ContactsModel, userPubkey).subscribe({
        next: (pointers) => {
          const pubkeys = (pointers || []).map((/** @type {{ pubkey: string }} */ p) => p.pubkey);
          followedPubkeys = pubkeys;
          isLoading = false;
          isLoaded = true;

          // Bulk-load kind 10002 (NIP-65 relay lists) for all contacts.
          // This populates the eventStore so OutboxModel/includeMailboxes can
          // reactively build outbox maps for the follows feed.
          // Guard against duplicate loads on ContactsModel re-emission.
          const lookupRelays = getRelayListLookupRelays();
          if (!mailboxLoadStarted && lookupRelays.length > 0 && pubkeys.length > 0) {
            mailboxLoadStarted = true;
            const mailboxLoader = createTimelineLoader(
              timedPool,
              lookupRelays,
              { kinds: [10002], authors: pubkeys },
              { eventStore }
            );
            const mailboxSub = mailboxLoader().subscribe();
            activeSubscriptions.push(mailboxSub);
          }

          // Load profiles for contacts
          const relays = getProfileLookupRelays();
          if (relays.length > 0) {
            pubkeys.forEach((pubkey) => {
              const profileSub = profileLoader({ kind: 0, pubkey, relays }).subscribe();
              activeSubscriptions.push(profileSub);
            });
          }
        },
        error: (error) => {
          console.error('Error loading contact profiles:', error);
          isLoading = false;
          isLoaded = true;
        }
      });
      activeSubscriptions.push(modelSubscription);
    } catch (error) {
      console.error('Failed to initialize contact loading:', error);
      isLoading = false;
      isLoaded = true;
    }
  },

  /**
   * Search contacts by display name or name
   * Looks up profiles synchronously from EventStore at search time,
   * so missing profiles are skipped rather than blocking the entire list.
   * @param {string} searchTerm - Search query
   * @param {number} [limit=10] - Maximum results to return
   * @returns {EnrichedContact[]} Filtered contacts
   */
  searchContacts(searchTerm, limit = 10) {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return [];
    }

    const term = searchTerm.toLowerCase().trim();

    /** @type {EnrichedContact[]} */
    const results = [];
    for (const pubkey of followedPubkeys) {
      const event = eventStore.getReplaceable(0, pubkey);
      if (!event) continue; // Profile not loaded yet — skip, don't block

      const profile = getProfileContent(event);
      if (!profile) continue;

      const name = (profile.name || '').toLowerCase();
      const displayName = (profile.display_name || '').toLowerCase();
      if (name.includes(term) || displayName.includes(term)) {
        results.push({
          pubkey,
          name: profile.name || null,
          display_name: profile.display_name || null,
          picture: profile.picture || null,
          nip05: profile.nip05 || null,
          about: profile.about || null
        });
      }
      if (results.length >= limit) break;
    }
    return results;
  },

  /**
   * Clear contacts and cleanup subscriptions
   */
  clear() {
    // Unsubscribe from all active subscriptions
    activeSubscriptions.forEach((sub) => {
      try {
        sub.unsubscribe();
      } catch (error) {
        console.error('Error unsubscribing:', error);
      }
    });
    activeSubscriptions = [];

    followedPubkeys = [];
    isLoading = false;
    isLoaded = false;
    mailboxLoadStarted = false;
  }
};
