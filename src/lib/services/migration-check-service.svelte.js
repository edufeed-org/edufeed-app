/**
 * Migration Check Service
 *
 * Detects old kind 30382 community memberships and opens a migration modal
 * so the user can selectively re-follow using the new kind 30000 follow set spec.
 * A kind 30078 (NIP-78) flag prevents the modal from reappearing.
 */

import { manager } from '$lib/stores/accounts.svelte';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { configReady, runtimeConfig } from '$lib/stores/config.svelte.js';
import { getCommunikeyRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { getTagValue } from 'applesauce-core/helpers';
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { UpdateAppData } from 'applesauce-actions/actions';
import { addressLoader } from '$lib/loaders/base.js';
import { firstValueFrom, lastValueFrom, toArray, timer } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

let ran = false;

/**
 * Get the NIP-78 d-tag identifier for the migration flag
 * @returns {string}
 */
export function getMigrationIdentifier() {
  const appName = runtimeConfig.appName || 'ComCal';
  return `${appName}/community-migration-v1`;
}

/**
 * Check if the migration flag (kind 30078) is already set.
 * @param {string} pubkey
 * @returns {Promise<boolean>} true if already migrated
 */
export async function isMigrationDone(pubkey) {
  const identifier = getMigrationIdentifier();
  const relays = getAllLookupRelays();

  // Load the flag event from network
  addressLoader({ kind: 30078, pubkey, identifier, relays }).subscribe();

  // Read from EventStore
  const event = await firstValueFrom(eventStore.replaceable(30078, pubkey, identifier), {
    defaultValue: null
  });

  if (!event) return false;

  // NIP-78 stores JSON in content — check both parsed and raw
  try {
    const parsed = JSON.parse(event.content);
    return parsed === 'done';
  } catch {
    return event.content === 'done';
  }
}

/**
 * Write the migration-done flag via NIP-78.
 */
export async function writeMigrationFlag() {
  const identifier = getMigrationIdentifier();
  await actionRunner.run(UpdateAppData, identifier, 'done');
}

/**
 * Fetch old kind 30382 events and extract community pubkeys that aren't yet in the follow set.
 * @param {string} pubkey
 * @returns {Promise<string[]>} community pubkeys needing migration
 */
export async function getUnmigratedCommunities(pubkey) {
  const communikeyRelays = getCommunikeyRelays();
  const writeRelays = await getWriteRelays(pubkey);

  // Deduplicate all relays into one set
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive state
  const allRelays = [...new Set([...communikeyRelays, ...writeRelays])];

  const filter = { kinds: [30382], authors: [pubkey] };

  // One-shot fetch with 5s timeout — collects ALL events before processing
  const oldEvents = await lastValueFrom(
    pool.request(allRelays, filter).pipe(takeUntil(timer(5_000)), toArray()),
    { defaultValue: [] }
  );

  // Filter to follow events only, extract community pubkeys
  /** @type {string[]} */
  const extracted = [];
  for (const e of oldEvents) {
    if (getTagValue(e, 'n') !== 'follow') continue;
    const d = getTagValue(e, 'd');
    if (d) extracted.push(d);
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive state, just dedup
  const oldCommunityPubkeys = [...new Set(extracted)];

  if (oldCommunityPubkeys.length === 0) return [];

  // Cross-reference with current follow set
  const followSetEvent = await firstValueFrom(
    eventStore.replaceable(30000, pubkey, 'communities'),
    { defaultValue: null }
  );

  if (!followSetEvent) return oldCommunityPubkeys;

  const currentPointers = getProfilePointersFromList(followSetEvent);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive state
  const currentPubkeys = new Set(
    currentPointers.map((/** @type {{pubkey: string}} */ p) => p.pubkey)
  );

  return oldCommunityPubkeys.filter((pk) => !currentPubkeys.has(pk));
}

/**
 * Main entry point. Checks for old 30382 memberships and opens migration modal if needed.
 * Safe to call multiple times — only runs once per session.
 * @returns {Promise<void>}
 */
export async function checkCommunityMigration() {
  if (ran) return;
  ran = true;

  try {
    // Wait for config
    await new Promise((resolve) => {
      /** @type {Function | undefined} */
      let unsub;
      unsub = configReady.subscribe((ready) => {
        if (ready) {
          queueMicrotask(() => unsub?.());
          resolve(undefined);
        }
      });
    });

    // Wait for active user (with timeout)
    const account = await new Promise((resolve) => {
      /** @type {import('rxjs').Subscription | undefined} */
      let sub;

      const timeout = setTimeout(() => {
        sub?.unsubscribe();
        resolve(null);
      }, 10_000);

      sub = manager.active$.subscribe((active) => {
        if (active) {
          clearTimeout(timeout);
          sub?.unsubscribe();
          resolve(active);
        }
      });
    });

    if (!account) return;

    const pubkey = /** @type {any} */ (account).pubkey;

    // Check if already migrated
    if (await isMigrationDone(pubkey)) return;

    // Find un-migrated communities
    const communityPubkeys = await getUnmigratedCommunities(pubkey);

    if (communityPubkeys.length === 0) {
      // No old communities to migrate — mark done silently
      await writeMigrationFlag();
      return;
    }

    // Open the migration modal
    modalStore.openModal('communityMigration', { communityPubkeys });
  } catch (err) {
    console.error('Migration check failed:', err);
  }
}

/** Reset the ran guard — for testing only */
export function _resetForTesting() {
  ran = false;
}
