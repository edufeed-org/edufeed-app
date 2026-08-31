/**
 * Relay Settings Service - Save NIP-65 relay preferences
 */

import { publishEvent } from './publish-service.js';
import { invalidateRelayListCache, getRelayListLookupRelays } from './relay-service.svelte.js';
import { manager } from '$lib/stores/accounts.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { nextCreatedAt, cachePublishedEvent } from '$lib/helpers/replaceableUpdates.js';

/** NIP-65 relay list metadata. */
const RELAY_LIST_KIND = 10002;

/**
 * Save relay list by publishing a kind 10002 event
 * @param {Array<{url: string, read: boolean, write: boolean}>} relays - Relay configuration
 * @param {string} userPubkey - User's public key
 * @returns {Promise<Object>} The signed and published event
 */
export async function saveRelayList(relays, userPubkey) {
  if (!manager.active?.signer) {
    throw new Error('No signer available. Please login first.');
  }

  if (!relays || relays.length === 0) {
    throw new Error('At least one relay is required');
  }

  // Build r tags based on read/write preferences
  const tags = relays.map((relay) => {
    const tag = ['r', relay.url];

    // If both read and write, no marker needed
    if (relay.read && relay.write) {
      return tag;
    }

    // If only read, add "read" marker
    if (relay.read && !relay.write) {
      tag.push('read');
      return tag;
    }

    // If only write, add "write" marker
    if (!relay.read && relay.write) {
      tag.push('write');
      return tag;
    }

    // If neither (shouldn't happen), default to both
    return tag;
  });

  // Create the event (kind 10002 - replaceable).
  // created_at must be strictly newer than the relay list it replaces, or the
  // save is dropped on a same-second tie — see nextCreatedAt for why. (#64)
  const event = {
    kind: RELAY_LIST_KIND,
    pubkey: userPubkey,
    created_at: nextCreatedAt(eventStore.getReplaceable(RELAY_LIST_KIND, userPubkey)),
    tags,
    content: ''
  };

  try {
    // Sign the event with applesauce-accounts signer
    const signedEvent = await manager.active.signer.signEvent(event);

    // Invalidate cache BEFORE publishing so we use the new relays
    invalidateRelayListCache(userPubkey);

    // Publish using the outbox model — PLUS, explicitly, the relays of the
    // NEW list itself and the relay-list lookup indexers. The outbox set is
    // resolved from the OLD list (or the fallbacks when none exists); when
    // that old set is broken or unreachable, publishing only there means a
    // user can never save their way OUT of a bad relay list (journey-test
    // 2026-08-17: account without a 10002 + flaky fallbacks → 'Failed to
    // publish to any relay' on the very save meant to fix it). NIP-65 also
    // wants the list ON the listed relays and findable via indexers.
    const additionalRelays = [
      ...relays.filter((relay) => relay.write).map((relay) => relay.url),
      ...getRelayListLookupRelays()
    ];
    const result = await publishEvent(signedEvent, [], { additionalRelays });

    if (!result.success) {
      throw new Error('Failed to publish to any relay');
    }

    // Kind 10002 is cacheable, and publishEvent never touches the EventStore —
    // so without this the saved relay list never reaches IDB and the next read
    // is served the PREVIOUS one from cache. That mis-routes every subsequent
    // query, which is why this site is the worst of the set in #64.
    cachePublishedEvent(signedEvent, result);

    return signedEvent;
  } catch (error) {
    console.error('Failed to save relay list:', error);
    throw new Error(
      'Failed to save relay list: ' + (error instanceof Error ? error.message : String(error))
    );
  }
}

// Relay URL validation lives in $lib/helpers/relay-input.js — normalizeRelayInput
// validates and normalizes in one step, so callers never re-derive the URL.

/**
 * Parse a relay list event (kind 10002) into a structured format
 * @param {import('nostr-tools').NostrEvent | null | undefined} event - The kind 10002 event
 * @returns {Array<{url: string, read: boolean, write: boolean}>}
 */
export function parseRelayListEvent(event) {
  if (!event || !event.tags) return [];

  return event.tags
    .filter((/** @type {string[]} */ tag) => tag[0] === 'r')
    .map((/** @type {string[]} */ tag) => {
      const url = tag[1];
      const marker = tag[2];

      return {
        url,
        read: !marker || marker === 'read',
        write: !marker || marker === 'write'
      };
    });
}
