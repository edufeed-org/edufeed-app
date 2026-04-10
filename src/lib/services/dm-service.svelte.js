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
import { GiftWrapsModel } from 'applesauce-common/models';
import { WrappedMessagesGroups } from 'applesauce-common/models';
import { unlockGiftWrap, isGiftWrapUnlocked } from 'applesauce-common/helpers/gift-wrap';
import { persistEncryptedContent } from 'applesauce-common/helpers/encrypted-content-cache';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import {
  getDmRelaysFromEvent,
  loadReadTimestamps,
  saveReadTimestamps,
  isConversationUnread
} from '$lib/helpers/dm.js';
import { getRelayListLookupRelays, getWriteRelays } from '$lib/services/relay-service.svelte.js';
import { getFallbackRelays } from '$lib/helpers/relay-helper.js';

// --- Module-level reactive state ---
let dmRelays = $state.raw(/** @type {string[]} */ ([]));
let hasDedicatedDmRelays = $state(false);
let lockedCount = $state(0);
let unlocking = $state(false);
let readTimestamps = $state(/** @type {Record<string, number>} */ ({}));
let unreadCount = $state(0);

/** @type {string | null} */
let activePubkey = null;

/** @type {import('applesauce-core/helpers/encrypted-content').EncryptedContentSigner | null} */
let activeSigner = null;

// Plain subscriptions (not reactive)
/** @type {{ unsubscribe: () => void }[]} */
let subscriptions = [];
/** @type {(() => void) | null} */
let persistCleanup = null;

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

  // 2. Load user's kind 10050 DM relay list
  const lookupRelays = getRelayListLookupRelays();
  if (lookupRelays.length > 0) {
    const relayLoadSub = addressLoader({
      kind: 10050,
      pubkey,
      relays: lookupRelays
    }).subscribe();
    subscriptions.push(relayLoadSub);
  }

  // 3. Watch for kind 10050 event to get DM relays, then subscribe to gift wraps.
  //    If no 10050 is found, fall back to the user's NIP-65 write relays + fallback relays
  //    so users without a dedicated DM relay list can still receive messages.
  let giftWrapSubStarted = false;

  const relayListSub = eventStore.replaceable(10050, pubkey).subscribe((event) => {
    const newRelays = getDmRelaysFromEvent(event);
    if (newRelays.length > 0 && JSON.stringify(newRelays) !== JSON.stringify(dmRelays)) {
      dmRelays = newRelays;
      hasDedicatedDmRelays = true;
      giftWrapSubStarted = true;
      subscribeToGiftWraps(pubkey, newRelays);
    }
  });
  subscriptions.push(relayListSub);

  // Fallback: if no kind 10050 found after 3s, use NIP-65 write relays + fallback relays
  const fallbackTimeout = setTimeout(async () => {
    if (giftWrapSubStarted) return;

    const writeRelays = await getWriteRelays(pubkey);
    const fallback = getFallbackRelays();
    const fallbackDmRelays = [...writeRelays, ...fallback].filter((r, i, a) => a.indexOf(r) === i);

    if (fallbackDmRelays.length > 0 && !giftWrapSubStarted) {
      dmRelays = fallbackDmRelays;
      giftWrapSubStarted = true;
      subscribeToGiftWraps(pubkey, fallbackDmRelays);
    }
  }, 3000);
  subscriptions.push({ unsubscribe: () => clearTimeout(fallbackTimeout) });

  // 4. Watch locked gift wraps for batch unlock
  const lockedSub = eventStore.model(GiftWrapsModel, pubkey, false).subscribe((wraps) => {
    lockedCount = wraps?.length || 0;
    if (wraps && wraps.length > 0 && !unlocking) {
      batchUnlock(wraps);
    }
  });
  subscriptions.push(lockedSub);

  // 5. Watch conversations for unread count
  const convSub = eventStore.model(WrappedMessagesGroups, pubkey).subscribe((conversations) => {
    if (!conversations) {
      unreadCount = 0;
      return;
    }
    let count = 0;
    for (const conv of conversations) {
      if (isConversationUnread(conv.id, conv.lastMessage.created_at, readTimestamps)) {
        count++;
      }
    }
    unreadCount = count;
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
  unreadCount = 0;
}

// --- Internal ---

/**
 * Subscribe to kind 1059 gift wraps on the user's DM relays.
 * @param {string} pubkey
 * @param {string[]} relays
 */
function subscribeToGiftWraps(pubkey, relays) {
  const sub = pool
    .subscription(relays, { kinds: [1059], '#p': [pubkey] })
    .pipe(mapEventsToStore(eventStore))
    .subscribe();
  subscriptions.push(sub);
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

  for (let i = 0; i < wraps.length; i += BATCH_SIZE) {
    const batch = wraps.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (wrap) => {
      // Skip already-unlocked wraps
      if (isGiftWrapUnlocked(wrap)) return;
      try {
        await unlockGiftWrap(wrap, /** @type {any} */ (activeSigner));
      } catch (err) {
        console.warn('Failed to unlock gift wrap:', wrap.id, err);
      }
    });
    await Promise.all(promises);

    // Yield to UI between batches
    if (i + BATCH_SIZE < wraps.length) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  unlocking = false;
}
