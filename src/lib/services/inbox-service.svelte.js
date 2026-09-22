/**
 * Unified inbox service.
 * Manages notification loaders, read state (NIP-78 kind 30078), and reactive counts.
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { finalizeDraft } from '$lib/helpers/event-factory.js';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
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
  getAllLookupRelays,
  getGroupsRelays
} from '$lib/helpers/relay-helper.js';
import {
  getNotificationType,
  isUnread,
  filterSelfNotifications,
  isMembershipApplication,
  mergeReadMarkers
} from '$lib/helpers/inbox.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import {
  getRelayListLookupRelays,
  getReadRelays,
  getWriteRelays
} from '$lib/services/relay-service.svelte.js';
import { normalizeURL } from 'applesauce-core/helpers';
import { getUnreadDmCount, markAllDmConversationsAsRead } from '$lib/services/dm-service.svelte.js';
import { getNip05ReadyCount } from '$lib/stores/nip05-ready-alert.svelte.js';
import { parseAddressPointerFromATag } from '$lib/helpers/nostrUtils.js';

const APP_DATA_D_TAG = 'comcal/inbox/last-seen';

/**
 * Content of the kind 30078 read marker. It is a constant on purpose: the
 * marker's only payload is its `created_at` (Jumble's model), so there is
 * nothing in the event worth encrypting and nothing a public relay can leak
 * beyond "this user checked their notifications around then". That also frees
 * cross-device sync from needing NIP-44 in the signer.
 */
export const READ_MARKER_CONTENT =
  'Records when notifications were last seen, to sync read state across devices.';

/** Minimum gap between two relay publishes of the marker, per pubkey. */
const MARKER_PUBLISH_INTERVAL = 10 * 60;

/** @type {Map<string, number>} pubkey -> unix seconds of the last relay publish */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- throttle bookkeeping, not UI state
const lastMarkerPublishAt = new Map();
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
 * Normalize a candidate relay list down to the entries the base set misses.
 *
 * Both of the inbox's outbox-model blind spots use this: reactions (kind 7)
 * land on the target author's NIP-65 *read* relays, and read markers (kind
 * 30078) land on the author's *write* relays — neither maps to an app relay
 * category, so neither is reachable from the base relay set alone.
 *
 * @param {string[]} baseRelays - relays already being queried
 * @param {string[]} candidateRelays
 * @returns {string[]} Normalized relay URLs not already in baseRelays
 */
export function getSupplementalNotificationRelays(baseRelays, candidateRelays) {
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
  for (const url of candidateRelays) {
    const normalized = safeNormalize(url);
    if (normalized && !base.has(normalized) && !supplemental.includes(normalized)) {
      supplemental.push(normalized);
    }
  }
  return supplemental;
}

/**
 * Parse the locally mirrored read markers.
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
const MARKERS_LOCALSTORAGE_PREFIX = 'comcal:inbox:read-markers:';

/**
 * Read the locally mirrored read markers for a user.
 *
 * The kind 30078 event is the cross-device record, but it is only as reliable
 * as the relays holding it. This mirror is what makes "mark all as read" stick
 * on the device that clicked it, instantly and regardless of relay weather.
 *
 * @param {string} pubkey
 * @returns {Record<string, number> | null}
 */
function loadStoredReadMarkers(pubkey) {
  try {
    return parseReadMarkers(localStorage.getItem(MARKERS_LOCALSTORAGE_PREFIX + pubkey));
  } catch {
    return null;
  }
}

/**
 * @param {string} pubkey
 * @param {Record<string, number> | null} markers
 */
function persistReadMarkers(pubkey, markers) {
  if (!markers) return;
  try {
    localStorage.setItem(MARKERS_LOCALSTORAGE_PREFIX + pubkey, JSON.stringify(markers));
  } catch {
    /* localStorage full or unavailable */
  }
}

/**
 * Fold newly learned markers into the current state and mirror the result.
 *
 * Merging (rather than assigning) is what keeps the badge from springing back:
 * the relay copy, the local mirror and the just-clicked in-memory state arrive
 * in no particular order, and a stale or unparseable one must never win.
 *
 * @param {string} pubkey - the pubkey the markers belong to
 * @param {Record<string, number> | null} incoming
 */
function applyReadMarkers(pubkey, incoming) {
  if (activePubkey !== pubkey) return; // account switched while we were decrypting
  const merged = mergeReadMarkers(readMarkers, incoming);
  if (!merged) return;
  readMarkers = merged;
  persistReadMarkers(pubkey, merged);
}

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
 * Open a standing REQ for live notifications and feed the event store; the
 * TimelineModel subscription in initializeInbox() sees them like loaded ones.
 * `group(relays, false)` rather than `pool.subscription`: the default drops
 * relays whose socket is not ready yet, which on a fresh login is all of
 * them (see subscribeToGiftWraps in dm-service for the full story).
 * @param {string[]} relays
 * @param {import('nostr-tools').Filter[]} filters
 */
function subscribeLive(relays, filters) {
  if (!relays.length) return;
  const sub = pool
    .group(relays, false)
    .subscription(filters)
    .subscribe({
      next: (event) => {
        if (event && typeof event === 'object' && 'id' in event) eventStore.add(event);
      },
      error: (err) => console.warn('[inbox] live notification stream error', err)
    });
  subscriptions.push(sub);
}

/**
 * Initialize inbox for logged-in user.
 * @param {string} pubkey
 */
export function initializeInbox(pubkey) {
  // The caller is a $effect on the active account (see routes/+layout.svelte),
  // which re-runs whenever that account object changes identity. Re-running
  // cleanup() for the account that is already live would drop the read markers
  // on the floor and light every notification up as unread again until the
  // relays answered — so a repeat call for the same pubkey is a no-op.
  if (activePubkey === pubkey) return;

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

  // Read markers, local mirror first: available synchronously, so the badge is
  // correct on the very first paint instead of after a relay round trip.
  readMarkers = loadStoredReadMarkers(pubkey);

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

  // ...and from the user's own write relays. markAsRead() publishes outbox-model
  // (kind 30078 maps to no app relay category), so for anyone whose write relays
  // don't overlap the lookup set, every marker ever written lives only there.
  getWriteRelays(pubkey).then((writeRelays) => {
    if (activePubkey !== pubkey) return;
    const supplemental = getSupplementalNotificationRelays(lookupRelays, writeRelays);
    if (!supplemental.length) return;
    subscriptions.push(
      addressLoader({
        kind: 30078,
        pubkey,
        identifier: APP_DATA_D_TAG,
        relays: supplemental
      }).subscribe()
    );
  });

  const markerSub = eventStore.replaceable(30078, pubkey, APP_DATA_D_TAG).subscribe((event) => {
    // The value is the event's timestamp; the content is never interpreted.
    // Legacy markers (plaintext or NIP-44 JSON with per-type keys) were always
    // written seconds after the timestamps they carried, so reading them the
    // same way needs no migration and no decryption.
    if (!event || !Number.isFinite(event.created_at)) return;
    // Merge, never assign: a stale relay copy must not move the state backwards.
    applyReadMarkers(pubkey, { global: event.created_at });
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

  // Standing subscription from now on. The loaders above are one-shot
  // (timedPool completes after 2 s), so without this the bell only learns
  // about a new reaction or reply on the next page load — and the OS toasts
  // (system-notifications.svelte.js) would never fire for the inbox. `since`
  // is the moment we subscribe: history stays with the loaders.
  const liveSince = Math.floor(Date.now() / 1000);
  const liveFilters = buildMainFilter(pubkey, liveSince);
  subscribeLive(relays, liveFilters);

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
    subscribeLive(supplementalRelays, liveFilters);
  });

  // Model subscription — watch eventStore for matching events. Derived from the
  // loader filters (minus `since`, the store already holds what was fetched) so
  // the two can never drift apart on kinds.
  // NIP-29 put-user events live on the groups host only: "an admin added you
  // to a group" (community root or channel) — see groups/group-added.js.
  const groupAddedFilter = { kinds: [9000], '#p': [pubkey], since };
  const groupRelays = getGroupsRelays();
  if (groupRelays.length > 0) {
    const groupAddedLoader = createTimelineLoader(timedPool, groupRelays, [groupAddedFilter], {
      eventStore,
      limit: 50
    });
    subscriptions.push(groupAddedLoader().subscribe());
  }

  const modelFilters = [...filters, groupAddedFilter].map(({ since: _since, ...rest }) => rest);
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
 * Mark all notifications as read.
 *
 * There is a single global marker. Per-type markers were never set by any
 * caller (every "mark as read" surface marks everything), and a single
 * timestamp is what lets the relay copy be just an event's `created_at`.
 */
export async function markAsRead() {
  if (!activePubkey || !manager.active) return;

  const now = Math.floor(Date.now() / 1000);
  const pubkey = activePubkey;
  const merged = mergeReadMarkers(readMarkers, { global: now }) || { global: now };
  readMarkers = merged;
  // Mirror locally before touching the network. Publishing can fail for any
  // number of relay reasons, and when it does the read state must still stick
  // on this device rather than silently reverting on the next reload.
  persistReadMarkers(pubkey, merged);
  markAllDmConversationsAsRead();

  // Relay copy, at most every MARKER_PUBLISH_INTERVAL: every bell click would
  // otherwise raise a signer prompt. The other devices lag by at most that
  // interval; this device is always exact via the mirror above.
  const lastPublished = lastMarkerPublishAt.get(pubkey) ?? -1;
  if (lastPublished >= 0 && now - lastPublished < MARKER_PUBLISH_INTERVAL) return;
  lastMarkerPublishAt.set(pubkey, now);

  const signer = manager.active.signer;
  /** @type {import('nostr-tools').NostrEvent | null} */
  let signed = null;
  try {
    const draft = await finalizeDraft({
      kind: 30078,
      content: READ_MARKER_CONTENT,
      created_at: now,
      tags: [['d', APP_DATA_D_TAG]]
    });
    signed = await signer.signEvent(draft);
  } catch (err) {
    console.error('Failed to sign read marker:', err);
    return;
  }

  if (!signed) return;
  eventStore.add(signed);
  try {
    // Kind 30078 maps to no app relay category, so publishEvent() would send it
    // to the author's NIP-65 write relays alone — while initializeInbox() reads
    // it back from the lookup relays. Those two sets overlapping was pure luck,
    // and when they didn't the marker was written where nothing ever read it.
    await publishEvent(signed, [], { additionalRelays: getRelayListLookupRelays() });
  } catch (err) {
    console.error('Failed to publish read markers:', err);
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
/**
 * Combined inbox + DM unread count, plus the granted-but-not-activated
 * membership handle. That grant is polled from the well-known directory,
 * never received as an event, so it cannot be an inbox item — but it is what
 * every inbox badge (navbar bell, dashboard sidebar, bottom tab bar, mobile
 * menu) must show, since before this the only surface that announced it was
 * the Termi assistant. Not cleared by markAsRead: it is a to-do with its own
 * dismiss (Nip05ReadyRow), like the Concord invites row.
 * @returns {number}
 */
export function getTotalUnreadCount() {
  return unreadCount + getUnreadDmCount() + getNip05ReadyCount();
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
