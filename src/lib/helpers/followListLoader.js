/**
 * Follow List Loader - NIP-02 and NIP-51 Implementation
 * Loads and parses user's follow lists (kind 3 events) and follow sets (kind 30000 events)
 */

import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { onlyEvents } from 'applesauce-relay/operators';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/**
 * @typedef {Object} FollowedProfile
 * @property {string} pubkey - The followed user's public key
 * @property {string} relay - Preferred relay for this user (optional)
 * @property {string} petname - Local name for this user (optional)
 */

/**
 * @typedef {Object} FollowList
 * @property {string} id - Unique identifier for this follow list
 * @property {string} name - Display name for the list
 * @property {'nip02' | 'nip51'} type - Type of list (NIP-02 or NIP-51)
 * @property {string} [description] - Optional description (NIP-51 only)
 * @property {FollowedProfile[]} profiles - Array of followed profiles
 * @property {string[]} pubkeys - Array of pubkeys (for convenience)
 * @property {number} count - Number of followed users
 * @property {number} createdAt - Timestamp when the list was created
 */

/**
 * Load the user's follow list (NIP-02 kind 3 event)
 * @param {string} userPubkey - The user's public key
 * @returns {Promise<FollowList | null>} The parsed follow list or null if not found
 */
export function loadFollowList(userPubkey) {
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const relays = runtimeConfig.fallbackRelays || [];
    let hasResolved = false;

    // Subscribe to kind 3 events for this user
    const subscription = pool
      .subscription(relays, {
        kinds: [3],
        authors: [userPubkey],
        limit: 1 // We only need the most recent
      })
      .pipe(onlyEvents())
      .subscribe({
        next: (event) => {
          if (hasResolved) return; // Ignore subsequent events

          const followList = parseFollowListEvent(event);
          hasResolved = true;
          subscription.unsubscribe();
          resolve(followList);
        },
        error: (err) => {
          console.error('👥 FollowListLoader: Error loading follow list:', err);
          reject(err);
        },
        complete: () => {
          if (!hasResolved) {
            hasResolved = true;
            resolve(null);
          }
        }
      });

    // Set a timeout to resolve with null if no response after 5 seconds
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        subscription.unsubscribe();
        resolve(null);
      }
    }, 5000);
  });
}

/**
 * Parse a NIP-02 kind 3 event into a FollowList object
 * @param {any} event - The Nostr kind 3 event
 * @returns {FollowList} The parsed follow list
 */
export function parseFollowListEvent(event) {
  // Extract 'p' tags (followed pubkeys)
  const profiles = event.tags
    .filter((/** @type {any[]} */ tag) => tag[0] === 'p')
    .map((/** @type {any[]} */ tag) => ({
      pubkey: tag[1],
      relay: tag[2] || '',
      petname: tag[3] || ''
    }));

  // Extract unique pubkeys for convenience
  const pubkeys = profiles.map((/** @type {FollowedProfile} */ p) => p.pubkey);

  /** @type {FollowList} */
  const followList = {
    id: `nip02-${event.pubkey}-${event.created_at}`, // Unique ID
    name: 'My Follows', // Default name (could be customized in future)
    type: 'nip02',
    profiles,
    pubkeys,
    count: profiles.length,
    createdAt: event.created_at
  };

  return followList;
}

/**
 * Load the user's follow sets (NIP-51 kind 30000 events)
 * @param {string} userPubkey - The user's public key
 * @returns {Promise<FollowList[]>} Array of parsed follow sets
 */
export function loadFollowSets(userPubkey) {
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const relays = runtimeConfig.fallbackRelays || [];
    /** @type {FollowList[]} */
    const followSets = [];
    let hasCompleted = false;

    // Subscribe to kind 30000 events for this user
    const subscription = pool
      .subscription(relays, {
        kinds: [30000],
        authors: [userPubkey]
      })
      .pipe(onlyEvents())
      .subscribe({
        next: (event) => {
          const followSet = parseFollowSetEvent(event);
          followSets.push(followSet);
        },
        error: (err) => {
          console.error('👥 FollowListLoader: Error loading follow sets:', err);
          reject(err);
        },
        complete: () => {
          if (!hasCompleted) {
            hasCompleted = true;
            resolve(followSets);
          }
        }
      });

    // Set a timeout to resolve with current sets after 5 seconds
    setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        subscription.unsubscribe();
        resolve(followSets);
      }
    }, 5000);
  });
}

/**
 * Parse a NIP-51 kind 30000 event into a FollowList object
 * @param {any} event - The Nostr kind 30000 event
 * @returns {FollowList} The parsed follow set
 */
export function parseFollowSetEvent(event) {
  // Extract 'p' tags (followed pubkeys)
  const profiles = event.tags
    .filter((/** @type {any[]} */ tag) => tag[0] === 'p')
    .map((/** @type {any[]} */ tag) => ({
      pubkey: tag[1],
      relay: tag[2] || '',
      petname: tag[3] || ''
    }));

  // Extract unique pubkeys for convenience
  const pubkeys = profiles.map((/** @type {FollowedProfile} */ p) => p.pubkey);

  // Extract metadata from tags
  const dTag = event.tags.find((/** @type {any[]} */ tag) => tag[0] === 'd')?.[1] || 'unnamed';
  const titleTag = event.tags.find((/** @type {any[]} */ tag) => tag[0] === 'title')?.[1];
  const descriptionTag = event.tags.find(
    (/** @type {any[]} */ tag) => tag[0] === 'description'
  )?.[1];

  /** @type {FollowList} */
  const followSet = {
    id: `nip51-${event.pubkey}-${dTag}`, // Unique ID using d tag
    name: titleTag || dTag, // Use title if available, otherwise d tag
    type: 'nip51',
    description: descriptionTag,
    profiles,
    pubkeys,
    count: profiles.length,
    createdAt: event.created_at
  };

  return followSet;
}

/**
 * Get pubkeys from multiple follow lists
 * @param {FollowList[]} followLists - Array of follow lists
 * @param {string[]} selectedListIds - IDs of lists to include
 * @returns {string[]} Unique array of pubkeys
 */
export function getAuthorsFromFollowLists(followLists, selectedListIds) {
  if (selectedListIds.length === 0) {
    return [];
  }

  const selectedLists = followLists.filter((list) => selectedListIds.includes(list.id));

  // Collect all pubkeys and deduplicate
  const pubkeysSet = new Set();
  selectedLists.forEach((list) => {
    list.pubkeys.forEach((pubkey) => pubkeysSet.add(pubkey));
  });

  const uniquePubkeys = Array.from(pubkeysSet);

  return uniquePubkeys;
}
