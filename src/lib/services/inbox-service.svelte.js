/**
 * Unified inbox service.
 * Manages notification loaders, read state (NIP-78 kind 30078), and reactive counts.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { AppDataFactory } from 'applesauce-common/factories';
import { finalizeDraft } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool, addressLoader, eventLoader } from '$lib/loaders/base.js';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { excludeMuted } from '$lib/helpers/dm-trust.js';
import { getMutedPubkeys, getMutedWords } from '$lib/stores/mute-list.svelte.js';
import {
  getCommunikeyRelays,
  getCalendarRelays,
  getEducationalRelays,
  getNotificationFallbackRelays,
  getAllLookupRelays
} from '$lib/helpers/relay-helper.js';
import {
  getNotificationType,
  isUnread,
  filterSelfNotifications,
  isMembershipApplication
} from '$lib/helpers/inbox.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { getRelayListLookupRelays, getReadRelays } from '$lib/services/relay-service.svelte.js';
import { normalizeURL } from 'applesauce-core/helpers';
import { getUnreadDmCount, markAllDmConversationsAsRead } from '$lib/services/dm-service.svelte.js';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';
import { hasNip44 } from '$lib/helpers/nip44.js';

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
  // Kind 1 is in here for NIP-10 replies and note mentions: most Nostr clients
  // answer a note with a kind 1 reply rather than a NIP-22 kind 1111 comment,
  // and the thread view renders both (see loaders/comments.js).
  return [
    { kinds: [1, 1070, 1069, 7, 9], '#p': [pubkey], since },
    { kinds: [1111], '#p': [pubkey], since },
    { kinds: [1111], '#P': [pubkey], since }
  ];
}

/**
 * Get deduplicated relay union for notification queries.
 * @returns {string[]}
 */
export function getNotificationRelays() {
  const all = [
    ...getCommunikeyRelays(),
    ...getCalendarRelays(),
    ...getEducationalRelays(),
    ...getNotificationFallbackRelays()
  ];
  return all.filter((url, i) => all.indexOf(url) === i);
}

/**
 * Get the user's read relays that are not already covered by the base
 * notification relays. Reactions (kind 7) are published outbox-model to the
 * target author's NIP-65 read relays and map to no app relay category, so the
 * inbox must also query the user's own read relays to see them.
 * @param {string[]} baseRelays
 * @param {string[]} readRelays
 * @returns {string[]} Normalized supplemental relay URLs
 */
export function getSupplementalNotificationRelays(baseRelays, readRelays) {
  /** @param {string} url */
  const safeNormalize = (url) => {
    try {
      return normalizeURL(url);
    } catch {
      return null;
    }
  };
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup set, not reactive
  const base = new Set(baseRelays.map(safeNormalize).filter(Boolean));
  /** @type {string[]} */
  const supplemental = [];
  for (const url of readRelays) {
    const normalized = safeNormalize(url);
    if (normalized && !base.has(normalized) && !supplemental.includes(normalized)) {
      supplemental.push(normalized);
    }
  }
  return supplemental;
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

/**
 * Raw notifications from the event store, with only the self-filter applied.
 * The membership-application filter is applied *reactively* in the derived
 * `mainNotifications` below — needed because runtimeConfig.membership loads
 * asynchronously after the inbox subscription fires its initial callback,
 * so filtering inside the subscribe callback would silently miss everything
 * received before config arrives.
 *
 * @type {import('nostr-tools').NostrEvent[]}
 */
let rawMainNotifications = $state.raw([]);

/** @type {import('nostr-tools').NostrEvent[]} */
let mainNotifications = $derived.by(() => {
  const membershipFormAddress = runtimeConfig.membership?.formAddress;
  const adminPubkeys = runtimeConfig.membership?.adminPubkeys || [];
  return rawMainNotifications.filter((e) => {
    if (!isMembershipApplication(e, membershipFormAddress)) return true;
    // Collision guard: a community's own application form (the removed
    // Beitrittsformular layer — copies from before 2026-08-18 still live on
    // relays) can share this exact 30168 address with the deployment's
    // membership form when a community reused that template —
    // isMembershipApplication only matches on the `a` tag, so it can't tell
    // the two apart. A REAL membership application is always p-tagged to a
    // configured deployment admin (see MembershipApplicationForm.svelte); a
    // community application copy is p-tagged to a root-group reviewer who
    // usually isn't one. Only hide it here (in favor of the admin panel)
    // when it's actually addressed to a deployment admin — otherwise it must
    // stay visible.
    return !e.tags.some((t) => t[0] === 'p' && adminPubkeys.includes(t[1]));
  });
});

/** @type {import('nostr-tools').NostrEvent[]} */
let rsvpNotifications = $state.raw([]);

/** @type {import('nostr-tools').NostrEvent[]} */
let pollResponseNotifications = $state.raw([]);

/** @type {Record<string, number> | null} */
let readMarkers = $state(null);

/** @type {string | null} */
let activePubkey = $state(null);

/** @type {Set<string>} */

let readItemIds = $state.raw(new Set());

/** @type {import('rxjs').Subscription[]} */
let subscriptions = [];

// Merge main + RSVPs + poll responses, sorted by time (newest first).
// Muted authors and muted words (NIP-51 kind 10000) are dropped display-side
// — the queries themselves stay ungated (issue #43). Word muting is what
// survives spam campaigns that rotate pubkeys.
let notifications = $derived.by(() => {
  return excludeMuted(
    [...mainNotifications, ...rsvpNotifications, ...pollResponseNotifications],
    getMutedPubkeys(),
    getMutedWords()
  ).sort((a, b) => b.created_at - a.created_at);
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
        if (manager.active && hasNip44(manager.active.signer)) {
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

  // Supplemental loader: the user's NIP-65 read relays. Reactions and other
  // p-tagged notifications are published outbox-model to these relays, which
  // may not overlap the app relay set (see issue #43). Read relays resolve
  // asynchronously, so this loader is spawned after the main one.
  getReadRelays(pubkey).then((readRelays) => {
    if (activePubkey !== pubkey) return; // inbox was cleaned up or switched user
    const supplementalRelays = getSupplementalNotificationRelays(relays, readRelays);
    if (!supplementalRelays.length) return;
    const supplementalLoader = createTimelineLoader(timedPool, supplementalRelays, filters, {
      eventStore,
      limit: 50
    });
    subscriptions.push(supplementalLoader().subscribe());
  });

  // Model subscription — watch eventStore for matching events. Derived from the
  // loader filters (minus `since`, the store already holds what was fetched) so
  // the two can never drift apart on kinds.
  const modelFilters = filters.map(({ since: _since, ...rest }) => rest);
  const modelSub = eventStore.model(TimelineModel, modelFilters).subscribe((events) => {
    const filtered = filterSelfNotifications(events || [], pubkey);
    rawMainNotifications = filtered;
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

  // Poll response loading: load user's polls (kind 1068), then responses (kind 1018) on those.
  const pollLoader = createTimelineLoader(
    timedPool,
    getCommunikeyRelays(),
    /** @type {any} */ ({
      kinds: [1068],
      authors: [pubkey],
      since: Math.floor(Date.now() / 1000) - 15552000
    }),
    { eventStore, limit: 100 }
  );

  const pollSub = pollLoader().subscribe({
    complete: () => {
      const pollModel = eventStore.model(TimelineModel, {
        kinds: [1068],
        authors: [pubkey]
      });
      const idsSub = pollModel.subscribe((events) => {
        if (!events?.length) return;
        const ids = events.map((e) => e.id);
        loadPollResponseNotifications(ids);
        idsSub.unsubscribe();
      });
      subscriptions.push(idsSub);
    }
  });
  subscriptions.push(pollSub);
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
 * Load poll response notifications (kind 1018) for the given poll IDs.
 * @param {string[]} pollIds
 */
export function loadPollResponseNotifications(pollIds) {
  if (!pollIds.length || !activePubkey) return;

  const since = Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK;

  const responseLoader = createTimelineLoader(
    timedPool,
    getCommunikeyRelays(),
    /** @type {any} */ ({ kinds: [1018], '#e': pollIds, since }),
    { eventStore, limit: 100 }
  );

  const sub = responseLoader().subscribe();
  subscriptions.push(sub);

  const pubkey = activePubkey;
  const modelSub = eventStore
    .model(TimelineModel, { kinds: [1018], '#e': pollIds })
    .subscribe((events) => {
      const filtered = filterSelfNotifications(events || [], pubkey);
      pollResponseNotifications = filtered;
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
      'reply',
      'mention',
      'rsvp',
      'pollVote'
    ]) {
      updated[t] = now;
    }
    // Also mark all DM conversations as read
    markAllDmConversationsAsRead();
  }

  readMarkers = updated;

  // Publish kind 30078 via AppDataFactory (v6). Note: the v5 code published
  // the unsigned draft; the events are now properly signed before publishing.
  const signer = manager.active.signer;
  try {
    const draft = await finalizeDraft(
      AppDataFactory.create(APP_DATA_D_TAG, updated, true).as(signer)
    );
    const signed = await signer.signEvent(draft);
    eventStore.add(signed);
    await publishEvent(signed);
  } catch {
    // Fallback: try without encryption (signer may not support NIP-44)
    try {
      const draft = await finalizeDraft(AppDataFactory.create(APP_DATA_D_TAG, updated, false));
      const signed = await signer.signEvent(draft);
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
  // `mainNotifications` is $derived FROM rawMainNotifications (see its
  // declaration above) — it must never be assigned directly. Svelte 5 lets a
  // $derived be reassigned as a one-off "override", but doing so permanently
  // severs it from its source expression: it becomes a plain frozen value
  // and stops recomputing when rawMainNotifications changes, FOREVER (this
  // silently killed the entire membership-application collision guard from
  // the very first initializeInbox() call, since cleanup() runs unconditionally
  // at its top). Reset the raw state instead and let the derived follow it.
  rawMainNotifications = [];
  rsvpNotifications = [];
  pollResponseNotifications = [];
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
