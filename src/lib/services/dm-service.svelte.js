/**
 * DM Service - Manages NIP-17 encrypted direct messages.
 *
 * Thin wrapper around applesauce models/helpers:
 * - Subscribes to kind 1059 gift wraps on user's DM relays
 * - Batch-unlocks gift wraps with user's signer
 * - Tracks per-conversation read state in localStorage
 * - Provides reactive getters for UI components
 *
 * Components subscribe to applesauce models directly (WrappedMessagesGroups,
 * WrappedMessagesGroup) for conversation data — this service only handles
 * the plumbing that models can't: relay subscriptions, unlock flow, read state.
 */
import { mapEventsToStore } from 'applesauce-core/observable';
import { filter, tap } from 'rxjs';
import { GiftWrapsModel } from 'applesauce-common/models';
import { WrappedMessagesGroups } from 'applesauce-common/models';
import { unlockGiftWrap, isGiftWrapUnlocked } from 'applesauce-common/helpers/gift-wrap';
import { persistEncryptedContent } from 'applesauce-common/helpers/encrypted-content-cache';
import { SvelteSet } from 'svelte/reactivity';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import {
  getDmRelaysFromEvent,
  loadReadTimestamps,
  saveReadTimestamps,
  isConversationUnread
} from '$lib/helpers/dm.js';
import { getRelayListLookupRelays, getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

// --- Module-level reactive state ---
let dmRelays = $state.raw(/** @type {string[]} */ ([]));
let hasDedicatedDmRelays = $state(false);
let lockedCount = $state(0);
let unlocking = $state(false);
let readTimestamps = $state(/** @type {Record<string, number>} */ ({}));
/** @type {{ id: string, participants: string[], lastMessage: any }[]} */
let dmConversations = $state.raw([]);
/**
 * True while the DM service is still doing its initial fetch for the active
 * account: we've called initializeDMs but the gift-wrap subscription hasn't
 * had a chance to deliver yet. Flips to false once the first wrap arrives or
 * a deadline expires (so an empty inbox doesn't show a spinner forever).
 */
let initialFetchInProgress = $state(false);
/** @type {ReturnType<typeof setTimeout> | null} */
let initialFetchDeadlineTimer = null;
/** Grace period for a freshly initialized DM service before we declare "no DMs". */
const INITIAL_FETCH_DEADLINE_MS = 8000;

/**
 * Settle-aware status of the user's own kind 10050 DM relay list lookup.
 * - 'idle'     : not checked (logged out, or nowhere to query)
 * - 'checking' : loaders fired, awaiting a 10050 or the settle deadline
 * - 'present'  : a kind 10050 exists for the user
 * - 'absent'   : settle deadline elapsed with no 10050 found
 *
 * Drives DmRelayBanner. We only conclude 'absent' after querying the user's
 * own NIP-65 write relays + identity indexers (both gate-bypassing) and giving
 * them time to respond — so we never prompt over a custom list we just hadn't
 * fetched yet. Keyed off getReplaceable(10050) to stay consistent with
 * ensureDmRelayList (otherwise "use recommended" could no-op and never hide).
 * @type {'idle' | 'checking' | 'present' | 'absent'}
 */
let dmRelayCheckStatus = $state('idle');
/** @type {ReturnType<typeof setTimeout> | null} */
let dmRelayCheckTimer = null;
/** How long to wait for the user's 10050 before declaring it absent. */
const DM_RELAY_CHECK_SETTLE_MS = 5000;
let unreadCount = $derived.by(() => {
  let count = 0;
  for (const conv of dmConversations) {
    if (isConversationUnread(conv.id, conv.lastMessage.created_at, readTimestamps)) {
      count++;
    }
  }
  return count;
});

/** @type {string | null} */
let activePubkey = null;

/** @type {import('applesauce-core/helpers/encrypted-content').EncryptedContentSigner | null} */
let activeSigner = null;

// Plain subscriptions (not reactive)
/** @type {{ unsubscribe: () => void }[]} */
let subscriptions = [];
/** @type {(() => void) | null} */
let persistCleanup = null;
/**
 * URLs we've already opened a gift-wrap subscription on. Used to dedupe when
 * the relay union grows (e.g. fallback relays subscribe immediately, then
 * kind 10050 arrives and contributes additional relays). Reset on cleanup().
 * @type {Set<string>}
 */
let subscribedRelays = new SvelteSet();
/**
 * IDs of gift wraps that previously threw during unlockGiftWrap (corrupt
 * wrap, key mismatch, etc.). Such wraps stay in GiftWrapsModel(_, false),
 * so without this guard a relay redelivery would loop batchUnlock forever
 * — flooding reactive state and tripping Svelte's effect-flush depth
 * guard. Mirrors the upstream applesauce gift-wrap example. Persisted per
 * pubkey to localStorage so a reload doesn't re-attempt the same wraps.
 * Cleared on cleanup() (logout / account switch).
 * @type {Set<string>}
 */
let failedUnlockIds = new SvelteSet();

/**
 * @param {string} pubkey
 * @returns {string}
 */
function failedUnlockStorageKey(pubkey) {
  return `comcal:dm:failed-gift-wraps:${pubkey}`;
}

/** @param {string} pubkey */
function loadFailedUnlockIds(pubkey) {
  try {
    const raw = localStorage.getItem(failedUnlockStorageKey(pubkey));
    if (!raw) return new SvelteSet();
    const parsed = JSON.parse(raw);
    return new SvelteSet(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new SvelteSet();
  }
}

/** @param {string} pubkey */
function saveFailedUnlockIds(pubkey) {
  try {
    localStorage.setItem(failedUnlockStorageKey(pubkey), JSON.stringify([...failedUnlockIds]));
  } catch {
    // Storage might be unavailable (private mode, quota); in-memory guard still works
  }
}

// --- Public reactive getters ---

/** @returns {string[]} */
export function getDmRelays() {
  return dmRelays;
}

/** @returns {number} */
export function getLockedCount() {
  return lockedCount;
}

/** @returns {boolean} */
export function isUnlockingDms() {
  return unlocking;
}

/** @returns {number} */
export function getUnreadDmCount() {
  return unreadCount;
}

/** @returns {boolean} Whether the user has a dedicated kind 10050 DM relay list */
export function hasDmRelayList() {
  return hasDedicatedDmRelays;
}

/**
 * @returns {'idle' | 'checking' | 'present' | 'absent'} Settle-aware status of
 * the active user's own kind 10050 lookup. Only 'absent' should trigger a
 * prompt — it means we queried the user's outbox + indexers and gave them time.
 */
export function getDmRelayCheckStatus() {
  return dmRelayCheckStatus;
}

/**
 * Conclude the DM-relay check after the settle window: 'present' if a kind
 * 10050 landed in the store, otherwise 'absent'. Guarded against stale fires
 * from a session that has since switched.
 * @param {string} pubkey
 */
function settleDmRelayCheck(pubkey) {
  dmRelayCheckTimer = null;
  if (activePubkey !== pubkey) return;
  if (dmRelayCheckStatus !== 'checking') return;
  dmRelayCheckStatus = eventStore.getReplaceable(10050, pubkey) ? 'present' : 'absent';
}

/** @returns {{ id: string, participants: string[], lastMessage: any }[]} */
export function getDmConversations() {
  return dmConversations;
}

/**
 * @returns {boolean} True when the initial fetch window has closed — either
 * because the conversation model emitted a non-empty list or the deadline
 * expired. While true, an empty `dmConversations` means "no DMs"; while false,
 * it means "still fetching, don't show empty state yet".
 */
export function hasInitialDmsLoaded() {
  return !initialFetchInProgress;
}

/** @returns {{ id: string, participants: string[], lastMessage: any }[]} */
export function getUnreadDmConversations() {
  return dmConversations.filter((conv) =>
    isConversationUnread(conv.id, conv.lastMessage.created_at, readTimestamps)
  );
}

/** Mark all DM conversations as read (latest message timestamp each). */
export function markAllDmConversationsAsRead() {
  if (dmConversations.length === 0) return;
  /** @type {Record<string, number>} */
  const updated = { ...readTimestamps };
  for (const conv of dmConversations) {
    updated[conv.id] = conv.lastMessage.created_at;
  }
  readTimestamps = updated;
  if (activePubkey) {
    saveReadTimestamps(activePubkey, updated);
  }
}

/**
 * Mark a conversation as read up to the given timestamp.
 * @param {string} conversationId
 * @param {number} timestamp
 */
export function markConversationAsRead(conversationId, timestamp) {
  readTimestamps = { ...readTimestamps, [conversationId]: timestamp };
  if (activePubkey) {
    saveReadTimestamps(activePubkey, readTimestamps);
  }
  // Recompute unread count will happen via $effect in components or
  // next time getUnreadDmCount is called after conversations update
}

/**
 * Check if a specific conversation has unread messages.
 * @param {string} conversationId
 * @param {number} lastMessageTimestamp
 * @returns {boolean}
 */
export function isDmConversationUnread(conversationId, lastMessageTimestamp) {
  return isConversationUnread(conversationId, lastMessageTimestamp, readTimestamps);
}

// --- Lifecycle ---

/**
 * Initialize DM service for a logged-in user.
 * Call on login (from accounts.svelte.js).
 * @param {string} pubkey
 * @param {import('applesauce-core/helpers/encrypted-content').EncryptedContentSigner} signer
 */
export function initializeDMs(pubkey, signer) {
  cleanup(); // Clean up any previous session

  activePubkey = pubkey;
  activeSigner = signer;
  readTimestamps = loadReadTimestamps(pubkey);
  failedUnlockIds = loadFailedUnlockIds(pubkey);

  // Open the initial-fetch window: while this is true, an empty conversation
  // list is interpreted as "still fetching" rather than "zero DMs". Closes on
  // the first non-empty model emission, or when the deadline expires (so an
  // account with no DMs eventually shows the empty state instead of spinning
  // forever).
  initialFetchInProgress = true;
  if (initialFetchDeadlineTimer) clearTimeout(initialFetchDeadlineTimer);
  initialFetchDeadlineTimer = setTimeout(() => {
    initialFetchInProgress = false;
    initialFetchDeadlineTimer = null;
  }, INITIAL_FETCH_DEADLINE_MS);

  // Begin the DM-relay self-check. Settles to 'present'/'absent' once a 10050
  // arrives (2c) or the deadline elapses (armed in 2b once relays resolve).
  dmRelayCheckStatus = 'checking';
  if (dmRelayCheckTimer) {
    clearTimeout(dmRelayCheckTimer);
    dmRelayCheckTimer = null;
  }

  // 1. Set up encrypted content persistence (survives page reloads)
  const storage = {
    /** @param {string} key */
    getItem: (key) => Promise.resolve(localStorage.getItem(`comcal:dm:cache:${key}`)),
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem: (key, value) => Promise.resolve(localStorage.setItem(`comcal:dm:cache:${key}`, value))
  };
  persistCleanup = persistEncryptedContent(eventStore, storage);

  // 2. Subscribe to gift wraps on the UNION of the user's NIP-65 write relays,
  //    app fallback relays, and (once it loads) the user's kind 10050 DM relay
  //    list. Why a union and not just kind 10050? In the wild, senders often
  //    publish wraps to *their* preferred relays rather than the recipient's
  //    declared DM relays — so a recipient who only listens on their kind 10050
  //    set will miss most of their messages. Listening on write+fallback covers
  //    those, and adding kind 10050 ensures we still pick up wraps from senders
  //    who do honor it. Subscriptions are added incrementally as relay sources
  //    resolve; we never tear down once subscribed.

  // 2a. Load user's kind 10050 DM relay list (async lookup)
  const lookupRelays = getRelayListLookupRelays();
  if (lookupRelays.length > 0) {
    const relayLoadSub = addressLoader({
      kind: 10050,
      pubkey,
      relays: lookupRelays
    }).subscribe();
    subscriptions.push(relayLoadSub);
  }

  // 2b. Subscribe immediately to NIP-65 write + app fallback relays. This is
  //     where most wraps actually live because senders publish to their own
  //     preferred relays. Doesn't wait for kind 10050.
  (async () => {
    if (activePubkey !== pubkey) return; // session switched while awaiting
    const writeRelays = await getWriteRelays(pubkey);
    if (activePubkey !== pubkey) return;
    /** @type {string[]} */
    const fallback = runtimeConfig.fallbackRelays || [];
    const baseRelays = [...writeRelays, ...fallback].filter((r, i, a) => a.indexOf(r) === i);
    if (baseRelays.length > 0) {
      console.debug('[dm] base relays → subscribing gift wraps', {
        relayCount: baseRelays.length,
        writeRelayCount: writeRelays.length,
        fallbackCount: fallback.length
      });
      addRelaysToGiftWrapSub(pubkey, baseRelays);
    }

    // Also query the user's own outbox for their kind 10050 — block 2a only
    // hits the identity indexers, but a user may have published their DM relay
    // list solely to their personal write relays. Without this we could wrongly
    // declare the list absent and prompt over a real one.
    if (writeRelays.length > 0) {
      const writeRelay10050Sub = addressLoader({
        kind: 10050,
        pubkey,
        relays: writeRelays
      }).subscribe();
      subscriptions.push(writeRelay10050Sub);
    }

    // Arm the settle deadline only once we know we actually queried somewhere.
    // If neither write relays nor indexers are available, we can't conclude
    // absence — leave status 'checking' so the banner stays hidden.
    if (
      dmRelayCheckStatus === 'checking' &&
      !dmRelayCheckTimer &&
      (writeRelays.length > 0 || lookupRelays.length > 0)
    ) {
      dmRelayCheckTimer = setTimeout(() => settleDmRelayCheck(pubkey), DM_RELAY_CHECK_SETTLE_MS);
    }
  })();

  // 2c. Watch kind 10050; merge any additional relays into the gift-wrap union.
  const relayListSub = eventStore.replaceable(10050, pubkey).subscribe((event) => {
    if (!event) return; // replaceable() emits undefined before anything loads
    // A 10050 exists → the self-check is conclusively satisfied. Keyed off the
    // event's existence (not its relay count) to match settleDmRelayCheck and
    // ensureDmRelayList, which both gate on getReplaceable(10050).
    dmRelayCheckStatus = 'present';
    if (dmRelayCheckTimer) {
      clearTimeout(dmRelayCheckTimer);
      dmRelayCheckTimer = null;
    }
    const newRelays = getDmRelaysFromEvent(event);
    if (newRelays.length > 0) {
      hasDedicatedDmRelays = true;
      const additions = newRelays.filter((r) => !subscribedRelays.has(r));
      console.debug('[dm] kind 10050 → merging into gift-wrap union', {
        listed: newRelays.length,
        additions: additions.length
      });
      if (additions.length > 0) {
        addRelaysToGiftWrapSub(pubkey, additions);
      }
    }
  });
  subscriptions.push(relayListSub);

  // 4. Watch locked gift wraps for batch unlock.
  //    Skip wraps that previously failed to unlock (corrupt wrap, key
  //    mismatch, etc.): those stay in GiftWrapsModel(_, false), so without
  //    this guard a relay redelivery would loop batchUnlock indefinitely,
  //    flipping reactive state and tripping Svelte's effect-flush depth
  //    guard. Pattern mirrors the upstream applesauce gift-wrap example.
  const lockedSub = eventStore.model(GiftWrapsModel, pubkey, false).subscribe((wraps) => {
    const tryable = (wraps || []).filter((w) => !failedUnlockIds.has(w.id));
    lockedCount = tryable.length;
    console.debug('[dm] locked gift wraps', {
      total: wraps?.length || 0,
      tryable: tryable.length,
      failed: failedUnlockIds.size,
      unlocking
    });
    if (tryable.length > 0 && !unlocking) {
      batchUnlock(tryable);
    }
  });
  subscriptions.push(lockedSub);

  // 5. Watch conversations for unread count
  const convSub = eventStore.model(WrappedMessagesGroups, pubkey).subscribe((conversations) => {
    dmConversations = conversations || [];
    // Close the initial-fetch window only on a non-empty emission. The model
    // emits `[]` synchronously on subscribe before any wraps have arrived from
    // relays; treating that as "loaded" would flash the empty state.
    if (dmConversations.length > 0 && initialFetchInProgress) {
      initialFetchInProgress = false;
      if (initialFetchDeadlineTimer) {
        clearTimeout(initialFetchDeadlineTimer);
        initialFetchDeadlineTimer = null;
      }
    }
    console.debug('[dm] WrappedMessagesGroups emission', {
      conversationCount: dmConversations.length
    });
  });
  subscriptions.push(convSub);
}

/** Clean up all subscriptions. Call on logout. */
export function cleanup() {
  for (const sub of subscriptions) {
    sub.unsubscribe();
  }
  subscriptions = [];
  persistCleanup?.();
  persistCleanup = null;

  activePubkey = null;
  activeSigner = null;
  dmRelays = [];
  hasDedicatedDmRelays = false;
  lockedCount = 0;
  unlocking = false;
  readTimestamps = {};
  dmConversations = [];
  if (initialFetchDeadlineTimer) {
    clearTimeout(initialFetchDeadlineTimer);
    initialFetchDeadlineTimer = null;
  }
  initialFetchInProgress = false;
  if (dmRelayCheckTimer) {
    clearTimeout(dmRelayCheckTimer);
    dmRelayCheckTimer = null;
  }
  dmRelayCheckStatus = 'idle';
  failedUnlockIds = new SvelteSet();
  subscribedRelays = new SvelteSet();
}

/**
 * Add the given relays to the active gift-wrap subscription union, deduping
 * against any URLs already subscribed. Called both for the initial base set
 * (NIP-65 write + fallback) and for kind 10050 additions as they arrive.
 * @param {string} pubkey
 * @param {string[]} relays
 */
function addRelaysToGiftWrapSub(pubkey, relays) {
  const newRelays = relays.filter((r) => !subscribedRelays.has(r));
  if (newRelays.length === 0) return;
  for (const r of newRelays) subscribedRelays.add(r);
  dmRelays = [...subscribedRelays];
  subscribeToGiftWraps(pubkey, newRelays);
}

// --- Internal ---

/**
 * Subscribe to kind 1059 gift wraps on the user's DM relays.
 * @param {string} pubkey
 * @param {string[]} relays
 */
function subscribeToGiftWraps(pubkey, relays) {
  console.debug('[dm] subscribeToGiftWraps()', {
    pubkey: pubkey.slice(0, 8),
    relays,
    poolRelayStates: relays.map((url) => {
      const r = pool.relays.get(url);
      return { url, found: !!r, ready: r?.ready ?? null };
    })
  });
  // IMPORTANT: use `group(relays, false)` rather than `pool.subscription(relays, …)`.
  // The default `pool.subscription` calls `group(relays)` with `ignoreOffline=true`,
  // which synchronously filters out any relay whose WebSocket isn't `ready` yet
  // (see applesauce-relay/dist/pool.js:52). On fresh login the DM relays were
  // *just* created when kind 10050 arrived — none are connected yet — so the
  // filter would drop them all and the resulting subscription would be silent
  // forever. Passing `false` keeps the relays in the group so the RelayGroup's
  // own connection lifecycle delivers events once the sockets come up.
  const sub = pool
    .group(relays, false)
    .subscription({ kinds: [1059], '#p': [pubkey] })
    .pipe(
      tap({
        next: (raw) => {
          if (typeof raw === 'string') {
            console.debug('[dm] gift-wrap stream string', raw.slice(0, 80));
          } else if (raw && typeof raw === 'object' && 'id' in raw) {
            console.debug('[dm] gift-wrap event from relay', {
              id: /** @type {any} */ (raw).id?.slice(0, 8),
              kind: /** @type {any} */ (raw).kind
            });
          }
        },
        error: (err) => console.warn('[dm] gift-wrap stream error', err),
        complete: () => console.debug('[dm] gift-wrap stream complete')
      }),
      mapEventsToStore(eventStore)
    )
    .subscribe();
  subscriptions.push(sub);

  // NIP-42 auth: many DM relays (e.g. auth.nostr1.com, haven.*) require AUTH
  // before they will return events. Without this, req() parks indefinitely in
  // applesauce-relay's waitForAuth gate and the gift-wrap stream is silent —
  // no events, no EOSE, no error. We subscribe to each DM relay's challenge$
  // and authenticate using the active signer when a challenge arrives.
  // Scoped to DM relays only: the user explicitly designated these for
  // personal messaging, so identifying ourselves via NIP-42 to them is
  // appropriate. Pool-wide auto-auth would leak the user's pubkey to every
  // relay the app touches.
  for (const url of relays) {
    const relay = pool.relay(url);
    const authSub = relay.challenge$.pipe(filter((c) => !!c)).subscribe(async () => {
      if (!activeSigner || relay.authenticated) return;
      try {
        // activeSigner is typed as EncryptedContentSigner (narrow shape used
        // for unlocking gift wraps). The real account signer also implements
        // AuthSigner.signEvent — cast to access it.
        await relay.authenticate(/** @type {any} */ (activeSigner));
        console.debug('[dm] authenticated to relay', url);
      } catch (err) {
        console.warn('[dm] auth failed for', url, err);
      }
    });
    subscriptions.push(authSub);

    // Per-relay status diagnostic. RelayGroup's catchError silently swallows
    // per-relay errors (group.js:84) — without this we can't tell whether a
    // DM relay is connected, auth-required, or errored.
    const statusSub = relay.status$.subscribe((s) => {
      console.debug('[dm] relay status', url, {
        connected: s.connected,
        ready: s.ready,
        authenticated: s.authenticated,
        authRequiredForRead: s.authRequiredForRead,
        authRequiredForPublish: s.authRequiredForPublish
      });
    });
    subscriptions.push(statusSub);
  }
}

/**
 * Batch-unlock gift wraps using the active signer.
 * Processes in chunks to avoid blocking the UI.
 * @param {import('nostr-tools').NostrEvent[]} wraps
 */
async function batchUnlock(wraps) {
  if (!activeSigner) return;

  unlocking = true;
  const BATCH_SIZE = 5;
  console.debug('[dm] batchUnlock start', { count: wraps.length });
  const startedAt = performance.now();
  let failedThisRun = 0;

  for (let i = 0; i < wraps.length; i += BATCH_SIZE) {
    const batch = wraps.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (wrap) => {
      // Skip already-unlocked wraps
      if (isGiftWrapUnlocked(wrap)) return;
      try {
        await unlockGiftWrap(wrap, /** @type {any} */ (activeSigner));
      } catch (err) {
        console.warn('Failed to unlock gift wrap:', wrap.id, err);
        failedUnlockIds.add(wrap.id);
        failedThisRun++;
      }
    });
    await Promise.all(promises);

    // Yield to UI between batches
    if (i + BATCH_SIZE < wraps.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (failedThisRun > 0 && activePubkey) {
    saveFailedUnlockIds(activePubkey);
  }
  unlocking = false;
  console.debug('[dm] batchUnlock done', {
    count: wraps.length,
    durationMs: Math.round(performance.now() - startedAt)
  });
}
