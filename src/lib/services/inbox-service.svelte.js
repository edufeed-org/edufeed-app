/**
 * Unified inbox service.
 * Manages notification loaders, read state (NIP-78 kind 30078), and reactive counts.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { AppDataBlueprint } from 'applesauce-common/blueprints';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool, addressLoader, eventLoader } from '$lib/loaders/base.js';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import {
  getCommunikeyRelays,
  getCalendarRelays,
  getEducationalRelays,
  getAllLookupRelays
} from '$lib/helpers/relay-helper.js';
import { getNotificationType, isUnread, filterSelfNotifications } from '$lib/helpers/inbox.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';
import { getUnreadDmCount, markAllDmConversationsAsRead } from '$lib/services/dm-service.svelte.js';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';

const APP_DATA_D_TAG = 'comcal/inbox/last-seen';
const DEFAULT_LOOKBACK = 604800; // 7 days

/** @type {Set<string>} IDs of events already prefetched */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive, internal tracking only
let prefetchedIds = new Set();

// --- Pure exported functions (testable) ---

/**
 * Build the combined filter array for the main notification loader.
 * @param {string} pubkey
 * @param {number} since
 * @returns {import('nostr-tools').Filter[]}
 */
export function buildMainFilter(pubkey, since) {
  return [
    { kinds: [1070, 1069, 7, 9], '#p': [pubkey], since },
    { kinds: [1111], '#p': [pubkey], since },
    { kinds: [1111], '#P': [pubkey], since }
  ];
}

/**
 * Get deduplicated relay union for notification queries.
 * @returns {string[]}
 */
export function getNotificationRelays() {
  const all = [...getCommunikeyRelays(), ...getCalendarRelays(), ...getEducationalRelays()];
  return all.filter((url, i) => all.indexOf(url) === i);
}

/**
 * Parse read markers from decrypted kind 30078 content.
 * @param {string | null} content
 * @returns {Record<string, number> | null}
 */
export function parseReadMarkers(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Extract referenced event pointers from a notification event's tags.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {{ addressPointers: Array<{kind: number, pubkey: string, identifier: string, relays: string[]}>, eventPointers: Array<{id: string, relays: string[]}> }}
 */
export function extractReferencedPointers(event) {
  /** @type {Array<{kind: number, pubkey: string, identifier: string, relays: string[]}>} */
  const addressPointers = [];
  /** @type {Array<{id: string, relays: string[]}>} */
  const eventPointers = [];

  const type = getNotificationType(event);
  if (!type || type === 'mention') return { addressPointers, eventPointers };

  // Extract 'a' or 'A' tags → addressable events
  const aTag = event.tags.findLast((t) => t[0] === 'a' || t[0] === 'A');
  if (aTag) {
    const pointer = parseAddressPointerFromATag(aTag);
    if (pointer) {
      addressPointers.push({
        ...pointer,
        relays: aTag[2] ? [aTag[2]] : getAllLookupRelays()
      });
    }
  }

  // Extract 'e' tags → regular events
  const eTag = event.tags.findLast((t) => t[0] === 'e');
  if (eTag && eTag[1]) {
    eventPointers.push({
      id: eTag[1],
      relays: eTag[2] ? [eTag[2]] : getAllLookupRelays()
    });
  }

  return { addressPointers, eventPointers };
}

/**
 * Prefetch referenced content from notification events into EventStore.
 * Fire-and-forget subscriptions so content is ready when user clicks.
 * @param {import('nostr-tools').NostrEvent[]} notifications
 */
function prefetchReferencedContent(notifications) {
  for (const event of notifications) {
    if (prefetchedIds.has(event.id)) continue;
    prefetchedIds.add(event.id);

    const { addressPointers, eventPointers } = extractReferencedPointers(event);

    for (const pointer of addressPointers) {
      addressLoader(pointer).subscribe();
    }
    for (const pointer of eventPointers) {
      eventLoader(pointer).subscribe();
    }
  }
}

// --- Reactive service (Svelte 5 runes) ---

/** @type {import('nostr-tools').NostrEvent[]} */
let mainNotifications = $state.raw([]);

/** @type {import('nostr-tools').NostrEvent[]} */
let rsvpNotifications = $state.raw([]);

/** @type {Record<string, number> | null} */
let readMarkers = $state(null);

/** @type {string | null} */
let activePubkey = $state(null);

/** @type {Set<string>} */

let readItemIds = $state.raw(new Set());

/** @type {import('rxjs').Subscription[]} */
let subscriptions = [];

// Merge main + RSVPs, sorted by time (newest first)
let notifications = $derived.by(() => {
  return [...mainNotifications, ...rsvpNotifications].sort((a, b) => b.created_at - a.created_at);
});

/**
 * Check if a notification is unread (single source of truth).
 * Combines per-item localStorage tracking with timestamp-based markers.
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {boolean}
 */
export function isNotificationUnread(event) {
  if (readItemIds.has(event.id)) return false;
  return isUnread(event, readMarkers);
}

let unreadCount = $derived.by(() => {
  if (!notifications.length) return 0;
  return notifications.filter((e) => isNotificationUnread(e)).length;
});

let unreadByType = $derived.by(() => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of notifications) {
    if (!isNotificationUnread(e)) continue;
    const type = getNotificationType(e);
    if (type) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
});

const LOCALSTORAGE_PREFIX = 'comcal:inbox:read-items:';

/**
 * Mark a single notification as read by event ID.
 * @param {string} eventId
 */
export function markItemAsRead(eventId) {
  if (!activePubkey) return;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() with plain Set
  readItemIds = new Set([...readItemIds, eventId]);
  try {
    localStorage.setItem(LOCALSTORAGE_PREFIX + activePubkey, JSON.stringify([...readItemIds]));
  } catch {
    /* localStorage full or unavailable */
  }
}

/**
 * Initialize inbox for logged-in user.
 * @param {string} pubkey
 */
export function initializeInbox(pubkey) {
  cleanup();
  activePubkey = pubkey;

  // Load persisted per-item read IDs
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_PREFIX + pubkey);
    if (stored) {
      const ids = JSON.parse(stored);
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() with plain Set
      if (Array.isArray(ids)) readItemIds = new Set(ids);
    }
  } catch {
    /* ignore parse errors */
  }

  // Load read markers (kind 30078) from relays
  const lookupRelays = getRelayListLookupRelays();
  if (lookupRelays.length > 0) {
    const markerLoaderSub = addressLoader({
      kind: 30078,
      pubkey,
      identifier: APP_DATA_D_TAG,
      relays: lookupRelays
    }).subscribe();
    subscriptions.push(markerLoaderSub);
  }

  const markerSub = eventStore
    .replaceable(30078, pubkey, APP_DATA_D_TAG)
    .subscribe(async (event) => {
      if (!event) return;
      let content = event.content;
      // Try NIP-44 decrypt (read markers may be encrypted to self)
      try {
        if (manager.active?.signer?.nip44?.decrypt) {
          content = await manager.active.signer.nip44.decrypt(pubkey, event.content);
        }
      } catch {
        /* use raw content as fallback (may be unencrypted) */
      }
      readMarkers = parseReadMarkers(content);
    });
  subscriptions.push(markerSub);

  // Always use 7-day default lookback for initial load.
  const since = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK;

  // Main loader (kinds 1070, 7, 1111, 9)
  const relays = getNotificationRelays();
  const filters = buildMainFilter(pubkey, since);
  const mainLoader = createTimelineLoader(timedPool, relays, filters, {
    eventStore,
    limit: 50
  });

  const mainSub = mainLoader().subscribe();
  subscriptions.push(mainSub);

  // Model subscription — watch eventStore for matching events
  const modelSub = eventStore
    .model(TimelineModel, [
      { kinds: [1070, 1069, 7, 9], '#p': [pubkey] },
      { kinds: [1111], '#p': [pubkey] },
      { kinds: [1111], '#P': [pubkey] }
    ])
    .subscribe((events) => {
      const filtered = filterSelfNotifications(events || [], pubkey);
      mainNotifications = filtered;
      prefetchReferencedContent(filtered);
    });
  subscriptions.push(modelSub);

  // RSVP loading: load user's calendar events, then RSVPs on those
  const calendarLoader = createTimelineLoader(
    timedPool,
    getCalendarRelays(),
    /** @type {any} */ ({
      kinds: [31922, 31923],
      authors: [pubkey],
      since: Math.floor(Date.now() / 1000) - 15552000
    }),
    { eventStore, limit: 100 }
  );

  const calSub = calendarLoader().subscribe({
    complete: () => {
      const calModel = eventStore.model(TimelineModel, {
        kinds: [31922, 31923],
        authors: [pubkey]
      });
      const coordSub = calModel.subscribe((events) => {
        if (!events?.length) return;
        const coords = events.map((e) => {
          const d = e.tags.find((t) => t[0] === 'd')?.[1] || '';
          return `${e.kind}:${e.pubkey}:${d}`;
        });
        loadRsvpNotifications(coords);
        coordSub.unsubscribe();
      });
      subscriptions.push(coordSub);
    }
  });
  subscriptions.push(calSub);
}

/**
 * Load RSVP notifications (separate query).
 * @param {string[]} calendarEventCoords
 */
export function loadRsvpNotifications(calendarEventCoords) {
  if (!calendarEventCoords.length || !activePubkey) return;

  const since = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK;

  const rsvpLoader = createTimelineLoader(
    timedPool,
    getCalendarRelays(),
    /** @type {any} */ ({ kinds: [31925], '#a': calendarEventCoords, since }),
    { eventStore, limit: 50 }
  );

  const sub = rsvpLoader().subscribe();
  subscriptions.push(sub);

  const pubkey = activePubkey;
  const modelSub = eventStore
    .model(TimelineModel, { kinds: [31925], '#a': calendarEventCoords })
    .subscribe((events) => {
      const filtered = filterSelfNotifications(events || [], pubkey);
      rsvpNotifications = filtered;
      prefetchReferencedContent(filtered);
    });
  subscriptions.push(modelSub);
}

/**
 * Mark notifications as read.
 * @param {string} [type] - Specific type, or omit for all
 */
export async function markAsRead(type) {
  if (!activePubkey || !manager.active) return;

  const now = Math.floor(Date.now() / 1000);
  /** @type {Record<string, number>} */
  const updated = { ...(readMarkers || {}), global: readMarkers?.global || now };

  if (type) {
    updated[type] = now;
  } else {
    updated.global = now;
    for (const t of [
      'formRequest',
      'formResponse',
      'reaction',
      'wave',
      'comment',
      'mention',
      'rsvp'
    ]) {
      updated[t] = now;
    }
    // Also mark all DM conversations as read
    markAllDmConversationsAsRead();
  }

  readMarkers = updated;

  // Publish kind 30078 via EventFactory + AppDataBlueprint
  const factory = createAppEventFactory({ signer: manager.active.signer });
  try {
    const signed = /** @type {import('nostr-tools').NostrEvent} */ (
      await factory.create(AppDataBlueprint, APP_DATA_D_TAG, updated, true)
    );
    eventStore.add(signed);
    await publishEvent(signed);
  } catch {
    // Fallback: try without encryption (signer may not support NIP-44)
    try {
      const signed = /** @type {import('nostr-tools').NostrEvent} */ (
        await factory.create(AppDataBlueprint, APP_DATA_D_TAG, updated, false)
      );
      eventStore.add(signed);
      await publishEvent(signed);
    } catch (err) {
      console.error('Failed to publish read markers:', err);
    }
  }
}

/** Clean up all subscriptions. */
export function cleanup() {
  for (const sub of subscriptions) sub.unsubscribe();
  subscriptions = [];
  mainNotifications = [];
  rsvpNotifications = [];
  readMarkers = null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() with plain Set
  readItemIds = new Set();
  prefetchedIds = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- not reactive
  activePubkey = null;
}

// Public reactive getters
export function getNotifications() {
  return notifications;
}
export function getUnreadCount() {
  return unreadCount;
}
/** @returns {number} Combined inbox + DM unread count */
export function getTotalUnreadCount() {
  return unreadCount + getUnreadDmCount();
}
export function getUnreadByType() {
  return unreadByType;
}
export function getReadMarkers() {
  return readMarkers;
}
/** @returns {(event: import('nostr-tools').NostrEvent) => boolean} */
export function getIsNotificationUnread() {
  return isNotificationUnread;
}
