/**
 * Unified inbox service.
 * Manages notification loaders, read state (NIP-78 kind 30078), and reactive counts.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { AppDataBlueprint } from 'applesauce-common/blueprints';
import { EventFactory } from 'applesauce-core/event-factory';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool, addressLoader } from '$lib/loaders/base.js';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import {
  getCommunikeyRelays,
  getCalendarRelays,
  getEducationalRelays
} from '$lib/helpers/relay-helper.js';
import { getNotificationType, isUnread, filterSelfNotifications } from '$lib/helpers/inbox.js';
import { getRelayListLookupRelays } from '$lib/services/relay-service.svelte.js';

const APP_DATA_D_TAG = 'comcal/inbox/last-seen';
const DEFAULT_LOOKBACK = 604800; // 7 days

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

// --- Reactive service (Svelte 5 runes) ---

/** @type {import('nostr-tools').NostrEvent[]} */
let mainNotifications = $state.raw([]);

/** @type {import('nostr-tools').NostrEvent[]} */
let rsvpNotifications = $state.raw([]);

/** @type {Record<string, number> | null} */
let readMarkers = $state(null);

/** @type {string | null} */
let activePubkey = $state(null);

/** @type {import('rxjs').Subscription[]} */
let subscriptions = [];

// Merge main + RSVPs, sorted by time (newest first)
let notifications = $derived.by(() => {
  return [...mainNotifications, ...rsvpNotifications].sort((a, b) => b.created_at - a.created_at);
});

let unreadCount = $derived.by(() => {
  if (!notifications.length) return 0;
  return notifications.filter((e) => isUnread(e, readMarkers)).length;
});

let unreadByType = $derived.by(() => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const e of notifications) {
    if (!isUnread(e, readMarkers)) continue;
    const type = getNotificationType(e);
    if (type) counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
});

/**
 * Initialize inbox for logged-in user.
 * @param {string} pubkey
 */
export function initializeInbox(pubkey) {
  cleanup();
  activePubkey = pubkey;

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
      mainNotifications = filterSelfNotifications(events || [], pubkey);
    });
  subscriptions.push(modelSub);

  // RSVP loading: load user's calendar events, then RSVPs on those
  const calendarLoader = createTimelineLoader(
    timedPool,
    getCalendarRelays(),
    { kinds: [31922, 31923], authors: [pubkey], since: Math.floor(Date.now() / 1000) - 15552000 },
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
    { kinds: [31925], '#a': calendarEventCoords, since },
    { eventStore, limit: 50 }
  );

  const sub = rsvpLoader().subscribe();
  subscriptions.push(sub);

  const pubkey = activePubkey;
  const modelSub = eventStore
    .model(TimelineModel, { kinds: [31925], '#a': calendarEventCoords })
    .subscribe((events) => {
      rsvpNotifications = filterSelfNotifications(events || [], pubkey);
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
    for (const t of ['formRequest', 'formResponse', 'reaction', 'comment', 'mention', 'rsvp']) {
      updated[t] = now;
    }
  }

  readMarkers = updated;

  // Publish kind 30078 via EventFactory + AppDataBlueprint
  const factory = new EventFactory({ signer: manager.active.signer });
  try {
    const signed = await factory.create(AppDataBlueprint, APP_DATA_D_TAG, updated, true);
    eventStore.add(signed);
    await publishEvent(signed);
  } catch {
    // Fallback: try without encryption (signer may not support NIP-44)
    try {
      const signed = await factory.create(AppDataBlueprint, APP_DATA_D_TAG, updated, false);
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
  activePubkey = null;
}

// Public reactive getters
export function getNotifications() {
  return notifications;
}
export function getUnreadCount() {
  return unreadCount;
}
export function getUnreadByType() {
  return unreadByType;
}
export function getReadMarkers() {
  return readMarkers;
}
