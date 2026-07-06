/**
 * Profile Badges Hook (NIP-58)
 *
 * Shows only the badges a user has explicitly accepted via their
 * profile_badges event (kind 10008, with kind 30008 as legacy fallback),
 * in the order they chose.
 *
 * Flow:
 * 1. Subscribe to kind 10008 + 30008 profile_badges events; pick the most recent.
 * 2. Extract (badgeAddress, awardId) slots from its `a`/`e` tag pairs.
 * 3. For each slot, load the kind 8 award (by id) + kind 30009 definition (by address).
 * 4. Compose display items in slot order.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally to avoid infinite loops */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader, eventLoader } from '$lib/loaders/base.js';
import { untrack } from 'svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

const PROFILE_BADGES_KIND = 10008;
const LEGACY_PROFILE_BADGES_KIND = 30008;
const PROFILE_BADGES_IDENTIFIER = 'profile_badges';

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
 * @typedef {{ badgeAddress: string, awardId: string }} ProfileBadgeSlot
 */

/**
 * Pure helper: extract ordered (badge, award) slots from a profile_badges event.
 * Per NIP-58, the event contains alternating `a` (definition pointer) + `e` (award id) tags.
 *
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {ProfileBadgeSlot[]}
 */
export function extractProfileBadgeSlots(event) {
  if (!event?.tags) return [];
  const slots = [];
  for (let i = 0; i < event.tags.length; i++) {
    const tag = event.tags[i];
    if (tag?.[0] !== 'a' || !tag[1]) continue;
    const next = event.tags[i + 1];
    if (next?.[0] !== 'e' || !next[1]) continue;
    slots.push({ badgeAddress: tag[1], awardId: next[1] });
    i++; // consume the paired `e` tag
  }
  return slots;
}

/**
 * Pure helper: compose display items from slots + loaded awards + loaded definitions.
 * Order follows the slot array (the user's curated choice).
 *
 * @param {ProfileBadgeSlot[]} slots
 * @param {Map<string, any>} awards - awardId → kind 8 event
 * @param {Map<string, any>} definitions - badgeAddress → definition shape
 * @returns {BadgeDisplayItem[]}
 */
export function buildProfileBadgeDisplayItems(slots, awards, definitions) {
  const items = [];
  for (const slot of slots) {
    const award = awards.get(slot.awardId);
    const def = definitions.get(slot.badgeAddress);
    const issuerPubkey = def?.pubkey || slot.badgeAddress.split(':')[1] || '';
    items.push({
      id: award?.id || slot.awardId,
      badgeName: def?.name || '',
      badgeDescription: def?.description || '',
      badgeImage: def?.image || '',
      badgeThumb: def?.thumb || '',
      issuerPubkey,
      awardedAt: award?.created_at || 0,
      badgeAddress: slot.badgeAddress
    });
  }
  return items;
}

/** Parse a kind 30009 event into the fields the UI needs.
 * @param {any} event - kind 30009 event
 */
function parseBadgeDefinition(event) {
  /** @param {string} name */
  const tag = (name) => event.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1] || '';
  return {
    pubkey: event.pubkey,
    name: tag('name'),
    description: tag('description'),
    image: tag('image'),
    thumb: tag('thumb')
  };
}

/**
 * Reactive hook: load a user's accepted badges (NIP-58 profile_badges list).
 *
 * @param {() => string} getPubkey - reactive pubkey getter
 * @returns {{ getBadges: () => BadgeDisplayItem[], isLoading: boolean }}
 */
export function useProfileBadges(getPubkey) {
  // Output state — drives the UI
  let badges = $state.raw(/** @type {BadgeDisplayItem[]} */ ([]));
  let isLoading = $state(true);

  // Internal state — plain `let` so writes don't re-trigger the effect
  /** @type {ProfileBadgeSlot[]} */
  let slots = [];
  /** @type {Map<string, any>} */
  let awardsMap = new Map();
  /** @type {Map<string, any>} */
  let definitionsMap = new Map();

  /** @type {Map<string, import('rxjs').Subscription>} */
  const slotSubscriptions = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let updateTimer;

  function recompute() {
    badges = buildProfileBadgeDisplayItems(slots, awardsMap, definitionsMap);
  }

  function scheduleRecompute() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(recompute, 50);
  }

  function clearSlotSubscriptions() {
    for (const sub of slotSubscriptions.values()) sub.unsubscribe();
    slotSubscriptions.clear();
  }

  /** Subscribe to a single slot's award + definition. Idempotent per key.
   * @param {ProfileBadgeSlot} slot
   * @param {string[]} relays
   */
  function subscribeSlot(slot, relays) {
    // Award (kind 8) — fetch by id, subscribe to store
    const awardKey = 'award:' + slot.awardId;
    if (!slotSubscriptions.has(awardKey)) {
      const loaderSub = eventLoader({ id: slot.awardId, relays }).subscribe();
      slotSubscriptions.set(awardKey + ':loader', loaderSub);
      const storeSub = eventStore.event(slot.awardId).subscribe((event) => {
        if (event) {
          awardsMap.set(slot.awardId, event);
          scheduleRecompute();
        }
      });
      slotSubscriptions.set(awardKey, storeSub);
    }

    // Definition (kind 30009) — fetch by address, subscribe to store
    const [kindStr, defPubkey, identifier] = slot.badgeAddress.split(':');
    const kind = parseInt(kindStr, 10);
    if (!defPubkey || isNaN(kind)) return;

    const defKey = 'def:' + slot.badgeAddress;
    if (!slotSubscriptions.has(defKey)) {
      const loaderSub = addressLoader({
        kind,
        pubkey: defPubkey,
        identifier: identifier || '',
        relays
      }).subscribe();
      slotSubscriptions.set(defKey + ':loader', loaderSub);
      const storeSub = eventStore
        .replaceable(kind, defPubkey, identifier || '')
        .subscribe((event) => {
          if (event) {
            definitionsMap.set(slot.badgeAddress, parseBadgeDefinition(event));
            scheduleRecompute();
          }
        });
      slotSubscriptions.set(defKey, storeSub);
    }
  }

  $effect(() => {
    const pubkey = getPubkey();
    if (!pubkey) {
      slots = [];
      awardsMap = new Map();
      definitionsMap = new Map();
      badges = [];
      isLoading = false;
      return;
    }

    // Reset state
    slots = [];
    awardsMap = new Map();
    definitionsMap = new Map();
    clearSlotSubscriptions();
    badges = [];
    isLoading = true;

    // Capture relays once (untrack avoids reactive deps through the SvelteMap)
    const relays = untrack(() => getAllLookupRelays());

    /** Track the newest profile_badges event seen across kinds 10008 + 30008. */
    /** @type {any} */
    let bestEvent = null;

    /** @param {any} event */
    function applyCandidate(event) {
      if (!event) return;
      if (bestEvent && event.created_at <= bestEvent.created_at) {
        isLoading = false;
        return;
      }
      bestEvent = event;
      slots = extractProfileBadgeSlots(event);
      isLoading = false;

      // Re-subscribe per slot. Subs for removed badges are torn down.
      clearSlotSubscriptions();
      awardsMap = new Map();
      definitionsMap = new Map();
      for (const slot of slots) subscribeSlot(slot, relays);

      recompute();
    }

    // Kick off network fetches for both spec kinds.
    // Kind 10008 is a plain replaceable event with NO d tag — an identifier
    // here would poison the batched relay filter with #d for every other
    // replaceable kind loaded in the same second (10015, 10050, 10222, ...).
    const pbLoaderNew = addressLoader({
      kind: PROFILE_BADGES_KIND,
      pubkey,
      relays
    }).subscribe();
    const pbLoaderLegacy = addressLoader({
      kind: LEGACY_PROFILE_BADGES_KIND,
      pubkey,
      identifier: PROFILE_BADGES_IDENTIFIER,
      relays
    }).subscribe();

    // Subscribe to store for whichever lands first / is newer
    const pbStoreNew = eventStore
      .replaceable(PROFILE_BADGES_KIND, pubkey)
      .subscribe(applyCandidate);
    const pbStoreLegacy = eventStore
      .replaceable(LEGACY_PROFILE_BADGES_KIND, pubkey, PROFILE_BADGES_IDENTIFIER)
      .subscribe(applyCandidate);

    // Flip off the loading flag after first network round-trip even if no event found
    const noBadgesTimer = setTimeout(() => {
      isLoading = false;
    }, 3000);

    return () => {
      pbLoaderNew.unsubscribe();
      pbLoaderLegacy.unsubscribe();
      pbStoreNew.unsubscribe();
      pbStoreLegacy.unsubscribe();
      clearSlotSubscriptions();
      clearTimeout(updateTimer);
      clearTimeout(noBadgesTimer);
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
