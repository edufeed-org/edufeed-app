/**
 * Badge Awards Hook
 *
 * Encapsulates the full badge loading flow:
 * 1. Load kind 8 awards (createTimelineLoader + TimelineModel)
 * 2. Load kind 30009 definitions (addressLoader + eventStore.replaceable)
 * 3. Combine into BadgeDisplayItem[] + load issuer profiles via useProfileMap
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool, addressLoader } from '$lib/loaders/base.js';
import { untrack } from 'svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * @typedef {{
 *   id: string,
 *   badgeName: string,
 *   badgeDescription: string,
 *   badgeImage: string,
 *   badgeThumb: string,
 *   issuerPubkey: string,
 *   awardedAt: number,
 *   badgeAddress: string
 * }} BadgeDisplayItem
 */

/**
 * Pure function: combine awards + definitions into display items.
 * Exported for testing.
 *
 * @param {any[]} awards - Award objects with id, issuerPubkey, badgeAddress, created_at
 * @param {Map<string, any>} definitions - Map of badgeAddress → badge definition
 * @returns {BadgeDisplayItem[]}
 */
export function buildBadgeDisplayItems(awards, definitions) {
  // Deduplicate by badge address, keeping most recent award
  /** @type {Map<string, any>} */
  const deduped = new Map();
  for (const award of awards) {
    const existing = deduped.get(award.badgeAddress);
    if (!existing || award.created_at > existing.created_at) {
      deduped.set(award.badgeAddress, award);
    }
  }

  const items = [];
  for (const award of deduped.values()) {
    const def = definitions.get(award.badgeAddress);
    items.push({
      id: award.id,
      badgeName: def?.name || '',
      badgeDescription: def?.description || '',
      badgeImage: def?.image || '',
      badgeThumb: def?.thumb || '',
      issuerPubkey: award.issuerPubkey,
      awardedAt: award.created_at,
      badgeAddress: award.badgeAddress
    });
  }

  // Sort by award date descending
  items.sort((a, b) => b.awardedAt - a.awardedAt);
  return items;
}

/**
 * Reactive hook: load and combine badge awards for a pubkey.
 *
 * @param {() => string} getPubkey - Reactive getter for user pubkey
 * @returns {{ getBadges: () => BadgeDisplayItem[], isLoading: boolean }}
 */
export function useBadgeAwards(getPubkey) {
  // Output state — these drive the UI
  let badges = $state.raw(/** @type {BadgeDisplayItem[]} */ ([]));
  let isLoading = $state(true);

  // Internal state — plain let to avoid $effect re-triggers
  /** @type {any[]} */
  let currentAwards = [];
  /** @type {Map<string, any>} */
  let definitionsMap = new Map();
  /** @type {Map<string, import('rxjs').Subscription>} */
  const defSubscriptions = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let defUpdateTimer;

  /** Recompute badges from current awards + definitions */
  function updateBadges() {
    badges = buildBadgeDisplayItems(currentAwards, definitionsMap);
  }

  // Load awards and subscribe to definitions
  $effect(() => {
    const pubkey = getPubkey();
    if (!pubkey) return;

    // Reset internal state
    currentAwards = [];
    definitionsMap = new Map();
    for (const sub of defSubscriptions.values()) sub.unsubscribe();
    defSubscriptions.clear();
    badges = [];
    isLoading = true;

    // Capture relays once to avoid reactive re-triggers (untrack prevents
    // the SvelteMap in userOverrideCache from creating a dependency)
    const relays = untrack(() => getAllLookupRelays());

    // Step 1: Load kind 8 awards from network
    const filter = { kinds: [8], '#p': [pubkey], limit: 200 };
    const loader = createTimelineLoader(timedPool, relays, filter, { eventStore });
    const loaderSub = loader().subscribe();

    // Step 2: Model subscribes to awards in EventStore
    const modelSub = eventStore.model(TimelineModel, { kinds: [8], '#p': [pubkey] }).subscribe({
      next: (events) => {
        currentAwards = (events || []).map((/** @type {any} */ event) => ({
          id: event.id,
          issuerPubkey: event.pubkey,
          created_at: event.created_at,
          badgeAddress: event.tags.find((/** @type {string[]} */ t) => t[0] === 'a')?.[1] || '',
          recipients: event.tags
            .filter((/** @type {string[]} */ t) => t[0] === 'p')
            .map((/** @type {string[]} */ t) => t[1])
        }));
        isLoading = false;
        updateBadges();

        // Step 3: For each award, load the badge definition
        for (const award of currentAwards) {
          if (!award.badgeAddress || defSubscriptions.has(award.badgeAddress)) continue;

          const [kindStr, defPubkey, identifier] = award.badgeAddress.split(':');
          const kind = parseInt(kindStr, 10);
          if (!defPubkey || isNaN(kind)) continue;

          // Fetch definition from network
          const defLoaderSub = addressLoader({
            kind,
            pubkey: defPubkey,
            identifier: identifier || '',
            relays
          }).subscribe();
          defSubscriptions.set(award.badgeAddress + ':loader', defLoaderSub);

          // Subscribe to definition in EventStore
          const defModelSub = eventStore
            .replaceable(kind, defPubkey, identifier || '')
            .subscribe((event) => {
              if (event) {
                const dTag =
                  event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
                definitionsMap.set(award.badgeAddress, {
                  name: event.tags?.find((/** @type {string[]} */ t) => t[0] === 'name')?.[1] || '',
                  description:
                    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'description')?.[1] ||
                    '',
                  image:
                    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'image')?.[1] || '',
                  thumb:
                    event.tags?.find((/** @type {string[]} */ t) => t[0] === 'thumb')?.[1] || '',
                  identifier: dTag,
                  address: award.badgeAddress
                });
                // Batch definition updates
                clearTimeout(defUpdateTimer);
                defUpdateTimer = setTimeout(() => {
                  updateBadges();
                }, 50);
              }
            });
          defSubscriptions.set(award.badgeAddress, defModelSub);
        }
      }
    });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
      for (const sub of defSubscriptions.values()) sub.unsubscribe();
      defSubscriptions.clear();
      clearTimeout(defUpdateTimer);
    };
  });

  return {
    get getBadges() {
      return () => badges;
    },
    get isLoading() {
      return isLoading;
    }
  };
}
