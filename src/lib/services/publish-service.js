/**
 * Unified Publishing Service with NIP-65 outbox model support
 *
 * Publishing flow:
 * 1. Outbox model: author's write relays + tagged users' read relays
 * 2. App-specific relays: based on event kind (calendar, communikey, educational)
 * 3. Community relays: if event targets a community (h-tag present)
 */
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { getPublishRelays, getPrimaryWriteRelay } from './relay-service.svelte.js';
import { getAppRelaysForCategory, kindToAppRelayCategory } from './app-relay-service.svelte.js';
import {
  getRelaysForKind,
  getCommunityGlobalRelays,
  getCommunityRelaysByEnforcement
} from '$lib/helpers/communityRelays.js';
import { manager } from '$lib/stores/accounts.svelte.js';
import { isWarmAndAuthenticated } from './relay-warming-service.svelte.js';

/**
 * Authenticate with a relay, with timeout
 * @param {import('applesauce-relay').Relay} relay
 * @param {any} signer
 * @param {number} timeout
 * @returns {Promise<boolean>} Whether auth succeeded
 */
async function authenticateRelay(relay, signer, timeout = 3000) {
  try {
    await Promise.race([
      relay.authenticate(signer),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), timeout))
    ]);
    return true;
  } catch {
    // Auth not required or timed out - continue anyway
    return false;
  }
}

/**
 * @typedef {Object} PublishStatus
 * @property {string} eventId - Event ID being published
 * @property {'pending' | 'publishing' | 'success' | 'failed'} status
 * @property {number} successCount - Number of successful relay publishes
 * @property {number} totalRelays - Total number of relays
 * @property {string} [error] - Error message if failed
 */

/** @type {Map<string, PublishStatus>} */
const publishStatusMap = new Map();

/** @type {Set<(status: PublishStatus) => void>} */
const statusListeners = new Set();

/**
 * Subscribe to publish status updates
 * @param {(status: PublishStatus) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function subscribeToPublishStatus(callback) {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

/**
 * Get current publish status for an event
 * @param {string} eventId
 * @returns {PublishStatus | undefined}
 */
export function getPublishStatus(eventId) {
  return publishStatusMap.get(eventId);
}

/**
 * Notify all listeners of status update
 * @param {PublishStatus} status
 */
function notifyStatusUpdate(status) {
  publishStatusMap.set(status.eventId, status);
  statusListeners.forEach((cb) => cb(status));

  // Auto-cleanup after 10 seconds for completed statuses
  if (status.status === 'success' || status.status === 'failed') {
    setTimeout(() => {
      publishStatusMap.delete(status.eventId);
    }, 10000);
  }
}

/**
 * Publish an event using outbox model + app relays + community relays
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent - The signed Nostr event
 * @param {string[]} [taggedPubkeys] - Array of pubkeys tagged in the event (p tags)
 * @param {Object} [opts] - Options
 * @param {number} [opts.timeout] - Timeout per relay in ms (default 5000)
 * @param {import('nostr-tools').NostrEvent | null} [opts.communityEvent] - Community definition event (kind 10222) if community-targeted
 * @param {string[]} [opts.additionalRelays] - Additional relays to publish to
 * @returns {Promise<{success: boolean, relays: string[], successCount: number, results?: any[]}>}
 */
export async function publishEvent(signedEvent, taggedPubkeys = [], opts = {}) {
  // Reduced timeout from 15s to 5s - warm connections should be fast
  const { timeout = 5000, communityEvent = null, additionalRelays = [] } = opts;
  const relaySet = new Set();

  // 1. Outbox model: author's write relays + tagged users' read relays
  const outboxRelays = await getPublishRelays(signedEvent.pubkey, taggedPubkeys);
  outboxRelays.forEach((r) => relaySet.add(r));

  // 2. App-specific relay for content type
  const category = kindToAppRelayCategory(signedEvent.kind);
  if (category) {
    getAppRelaysForCategory(category).forEach((r) => relaySet.add(r));
  }

  // 3. If community-targeted, add community's relays
  if (communityEvent) {
    // Add communikey app relay (for discoverability)
    getAppRelaysForCategory('communikey').forEach((r) => relaySet.add(r));

    // Add community's relays for this content type
    getRelaysForKind(communityEvent, signedEvent.kind).forEach((r) => relaySet.add(r));

    // Add community's global relays (including enforced)
    getCommunityGlobalRelays(communityEvent).forEach((r) => relaySet.add(r));

    // Ensure enforced relays are always included
    const { enforced } = getCommunityRelaysByEnforcement(communityEvent);
    enforced.forEach((r) => relaySet.add(r));
  }

  // 4. Additional relays (explicit)
  additionalRelays.forEach((r) => relaySet.add(r));

  const publishRelays = Array.from(relaySet);

  // Publish to all calculated relays with timeout
  const publishPromises = publishRelays.map(async (relayUrl) => {
    try {
      const relay = pool.relay(relayUrl);

      // Authenticate if not already warm+authenticated (with 3s timeout)
      if (!isWarmAndAuthenticated(relayUrl) && manager.active?.signer) {
        await authenticateRelay(relay, manager.active.signer, 3000);
      }

      await relay.publish(signedEvent, { timeout });
      return { relay: relayUrl, success: true };
    } catch (err) {
      console.warn(`Failed to publish to ${relayUrl}:`, err);
      return { relay: relayUrl, success: false, error: err };
    }
  });

  const results = await Promise.allSettled(publishPromises);
  const successCount = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;

  return {
    success: successCount > 0,
    relays: publishRelays,
    successCount,
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : { success: false }))
  };
}

/**
 * Publish an event in the background (fire-and-forget)
 * Calls onComplete callback when done with results
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent - The signed Nostr event
 * @param {string[]} taggedPubkeys - Array of pubkeys tagged in the event (p tags)
 * @param {Function} onComplete - Callback with publish result
 * @param {Object} [opts] - Options passed to publishEvent
 */
export function publishEventInBackground(signedEvent, taggedPubkeys = [], onComplete, opts = {}) {
  publishEvent(signedEvent, taggedPubkeys, opts)
    .then((result) => {
      if (onComplete) onComplete(result);
    })
    .catch((error) => {
      console.error('Background publish failed:', error);
      if (onComplete) onComplete({ success: false, relays: [], successCount: 0, error });
    });
}

/**
 * Optimistic publish - adds event to EventStore immediately, publishes in background
 * Returns as soon as ONE relay succeeds. Shows alert if all relays fail.
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent - The signed Nostr event
 * @param {string[]} [taggedPubkeys] - Array of pubkeys tagged in the event (p tags)
 * @param {Object} [opts] - Options
 * @param {number} [opts.timeout] - Timeout per relay in ms (default 5000)
 * @param {import('nostr-tools').NostrEvent | null} [opts.communityEvent] - Community definition event if community-targeted
 * @param {string[]} [opts.additionalRelays] - Additional relays to publish to
 * @param {(status: PublishStatus) => void} [opts.onStatusChange] - Callback for status updates
 * @returns {void} Returns immediately after adding to EventStore
 */
export function publishEventOptimistic(signedEvent, taggedPubkeys = [], opts = {}) {
  const { timeout = 5000, communityEvent = null, additionalRelays = [], onStatusChange } = opts;

  // 1. Immediately add to EventStore for instant UI update
  eventStore.add(signedEvent);

  // 2. Initialize status
  /** @type {{eventId: string, status: 'pending' | 'publishing' | 'success' | 'failed', successCount: number, totalRelays: number, error?: string}} */
  const status = {
    eventId: signedEvent.id,
    status: 'pending',
    successCount: 0,
    totalRelays: 0
  };
  notifyStatusUpdate(status);
  onStatusChange?.(status);

  // 3. Calculate relays and publish in background
  (async () => {
    const relaySet = new Set();

    // Outbox model: author's write relays + tagged users' read relays
    const outboxRelays = await getPublishRelays(signedEvent.pubkey, taggedPubkeys);
    outboxRelays.forEach((r) => relaySet.add(r));

    // App-specific relay for content type
    const category = kindToAppRelayCategory(signedEvent.kind);
    if (category) {
      getAppRelaysForCategory(category).forEach((r) => relaySet.add(r));
    }

    // Community relays if community-targeted
    if (communityEvent) {
      getAppRelaysForCategory('communikey').forEach((r) => relaySet.add(r));
      getRelaysForKind(communityEvent, signedEvent.kind).forEach((r) => relaySet.add(r));
      getCommunityGlobalRelays(communityEvent).forEach((r) => relaySet.add(r));
      const { enforced } = getCommunityRelaysByEnforcement(communityEvent);
      enforced.forEach((r) => relaySet.add(r));
    }

    // Additional relays
    additionalRelays.forEach((r) => relaySet.add(r));

    const publishRelays = Array.from(relaySet);
    status.totalRelays = publishRelays.length;
    status.status = 'publishing';
    notifyStatusUpdate({ ...status });
    onStatusChange?.({ ...status });

    let firstSuccess = false;

    // Publish to all relays, update status as each completes
    const publishPromises = publishRelays.map(async (relayUrl) => {
      try {
        const relay = pool.relay(relayUrl);

        // Authenticate if not already warm+authenticated (with 3s timeout)
        if (!isWarmAndAuthenticated(relayUrl) && manager.active?.signer) {
          await authenticateRelay(relay, manager.active.signer, 3000);
        }

        await relay.publish(signedEvent, { timeout });

        // Update success count
        status.successCount++;

        // Mark as success on first successful publish
        if (!firstSuccess) {
          firstSuccess = true;
          status.status = 'success';
        }

        notifyStatusUpdate({ ...status });
        onStatusChange?.({ ...status });

        return { relay: relayUrl, success: true };
      } catch (err) {
        console.warn(`Failed to publish to ${relayUrl}:`, /** @type {any} */ (err)?.message || err);
        return { relay: relayUrl, success: false, error: err };
      }
    });

    // Wait for all to complete
    await Promise.allSettled(publishPromises);

    // If no relays succeeded, mark as failed and remove from EventStore
    if (status.successCount === 0) {
      status.status = 'failed';
      status.error = 'Failed to publish to any relay';
      notifyStatusUpdate({ ...status });
      onStatusChange?.({ ...status });

      // Remove optimistically added event since publish failed completely
      eventStore.remove(signedEvent);
    }
  })();
}

/**
 * Build p tags with relay hints for recipients
 * @param {string[]} recipientPubkeys - Array of recipient pubkeys
 * @returns {Promise<string[][]>} Array of p tags with relay hints
 */
export async function buildPTagsWithHints(recipientPubkeys) {
  return Promise.all(
    recipientPubkeys.map(async (pubkey) => {
      const relayHint = await getPrimaryWriteRelay(pubkey);
      return ['p', pubkey, relayHint];
    })
  );
}

/**
 * Build an e tag with relay hint
 * @param {string} eventId - Event ID to reference
 * @param {string} authorPubkey - Author of the referenced event
 * @returns {Promise<string[]>} e tag with relay hint
 */
export async function buildETagWithHint(eventId, authorPubkey) {
  const relayHint = await getPrimaryWriteRelay(authorPubkey);
  return ['e', eventId, relayHint];
}

/**
 * Build an a tag with relay hint for addressable events
 * @param {string} address - Addressable event coordinate (e.g., "30009:pubkey:identifier")
 * @returns {Promise<string[]>} a tag with relay hint
 */
export async function buildATagWithHint(address) {
  // Extract pubkey from address (format: "kind:pubkey:identifier")
  const parts = address.split(':');
  if (parts.length >= 2) {
    const pubkey = parts[1];
    const relayHint = await getPrimaryWriteRelay(pubkey);
    return ['a', address, relayHint];
  }
  return ['a', address];
}
