/**
 * Unified Publishing Service with NIP-65 outbox model support
 *
 * Publishing flow:
 * 1. Outbox model: author's write relays + tagged users' read relays
 * 2. App-specific relays: based on event kind (calendar, communikey, educational)
 * 3. Community relays: if event targets a community (h-tag present)
 */
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { uncacheEvent, recacheEvent } from '$lib/stores/event-cache.svelte.js';
import { isAddressableKind, isReplaceableKind } from 'applesauce-core/helpers/event';
import { getPublishRelays, getPrimaryWriteRelay } from './relay-service.svelte.js';
import { getAppRelaysForCategory, kindToAppRelayCategory } from './app-relay-service.svelte.js';
import { getFallbackRelays } from '$lib/helpers/relay-helper.js';
import {
  getRelaysForKind,
  getCommunityGlobalRelays,
  getCommunityRelaysByEnforcement
} from '$lib/helpers/communityRelays.js';
import * as outbox from './publish-outbox.js';
/**
 * @typedef {Object} PublishStatus
 * @property {string} eventId - Event ID being published
 * @property {'pending' | 'publishing' | 'success' | 'failed'} status
 * @property {number} successCount - Number of successful relay publishes
 * @property {number} totalRelays - Total number of relays
 * @property {string} [error] - Error message if failed
 * @property {boolean} [retryQueued] - On failure: at least one relay never answered, so the outbox will retry
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
 * Publish a signed event to exactly the given relays — no outbox union, no
 * app-relay or fallback expansion. This is the primitive the *scoped*
 * publishers need: content that must not reach the author's public write
 * relays (gift wraps, membership applications) picks its own relay set and
 * hands it here.
 *
 * `publishEvent` below is the outbox-model counterpart: it computes a relay
 * set and then does this same fan-out. It still carries its own copy of the
 * loop; migrating it is a follow-up.
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent - The signed Nostr event
 * @param {string[]} relays - Exact relay URLs to publish to
 * @param {Object} [opts] - Options
 * @param {number} [opts.timeout] - Timeout per relay in ms (default 5000)
 * @param {number} [opts.retries] - Transport-error retries per relay (default 2)
 * @param {string} [opts.label] - Prefix for the rejection warning, e.g. '[membership]'
 * @param {any} [opts.pool] - Relay pool (injectable for tests)
 * @returns {Promise<{success: boolean, relays: string[], successCount: number, results: { ok: boolean, message?: string, from: string }[]}>}
 */
export async function publishToRelays(signedEvent, relays, opts = {}) {
  const { timeout = 5000, retries = 2, label = '', pool: relayPool = pool } = opts;
  const targets = [...new Set((relays || []).filter(Boolean))];
  if (targets.length === 0) {
    return { success: false, relays: [], successCount: 0, results: [] };
  }

  // pool.publish is applesauce's own multi-relay fan-out, and it does what our
  // hand-rolled Promise.allSettled did plus one thing it could not: it retries
  // a relay that failed to *reach*. Errors stay isolated per relay
  // (errorToPublishResponse turns them into { ok: false }), so one dead relay
  // still cannot reject the whole publish.
  //
  // Both defaults are overridden deliberately. The library's 30s timeout is far
  // too long behind a submit button, and retries are capped so a fully dead
  // relay set cannot stack 3 x 30s. Retries fire only on a *thrown* error —
  // a relay that answers OK:false has made a decision, and resubscribing would
  // just ask a second time and get the same no.
  /** @type {{ ok: boolean, message?: string, from: string }[]} */
  const responses = await relayPool.publish(targets, signedEvent, { timeout, retries });

  for (const response of responses) {
    if (!response?.ok) {
      console.warn(
        `${label} relay ${response?.from} rejected the event:`.trim(),
        response?.message
      );
    }
  }

  const successCount = responses.filter((r) => r?.ok).length;
  return { success: successCount > 0, relays: targets, successCount, results: responses };
}

/**
 * The relay set an outbox-model publish goes to. Shared by `publishEvent`,
 * `publishEventOptimistic` and the outbox replay so all three agree.
 *
 * 1. Outbox model: author's write relays + tagged users' read relays
 * 2. App-specific relays for the kind's category
 * 3. Community relays (communikey app relay, per-kind, global, enforced)
 * 4. Explicit additional relays
 * 5. Safety net: a fresh account (no NIP-65 write relays) publishing a kind
 *    without an app-relay category (kind 1 note, kind 1068 poll, kind 1063
 *    attestation) can end up with an EMPTY set — the event would silently go
 *    nowhere. Fall back to the deployment fallback relays (empty in gated
 *    mode, where users are provisioned with proper relay lists).
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent
 * @param {string[]} taggedPubkeys
 * @param {{ communityEvent?: import('nostr-tools').NostrEvent | null, additionalRelays?: string[] }} opts
 * @returns {Promise<string[]>}
 */
export async function computePublishRelays(signedEvent, taggedPubkeys, opts = {}) {
  const { communityEvent = null, additionalRelays = [] } = opts;
  const relaySet = new Set();

  const outboxRelays = await getPublishRelays(signedEvent.pubkey, taggedPubkeys);
  outboxRelays.forEach((r) => relaySet.add(r));

  const category = kindToAppRelayCategory(signedEvent.kind);
  if (category) {
    getAppRelaysForCategory(category).forEach((r) => relaySet.add(r));
  }

  if (communityEvent) {
    getAppRelaysForCategory('communikey').forEach((r) => relaySet.add(r));
    getRelaysForKind(communityEvent, signedEvent.kind).forEach((r) => relaySet.add(r));
    getCommunityGlobalRelays(communityEvent).forEach((r) => relaySet.add(r));
    const { enforced } = getCommunityRelaysByEnforcement(communityEvent);
    enforced.forEach((r) => relaySet.add(r));
  }

  additionalRelays.forEach((r) => relaySet.add(r));

  if (relaySet.size === 0) {
    getFallbackRelays().forEach((r) => relaySet.add(r));
  }

  return Array.from(relaySet);
}

/**
 * Publish to ONE relay and settle the outbox for it.
 *
 * `answered` separates the two ways this can fail: a relay that responded
 * OK:false has made a decision and is cleared from the outbox (asking again
 * gets the same no); a relay that threw (connection, timeout) never answered
 * and stays pending for the replay.
 *
 * @param {string} relayUrl
 * @param {import('nostr-tools').NostrEvent} signedEvent
 * @param {number} timeout
 * @returns {Promise<{ relay: string, success: boolean, answered: boolean, error?: any }>}
 */
async function publishToRelay(relayUrl, signedEvent, timeout) {
  try {
    const relay = pool.relay(relayUrl);
    // relay.publish RESOLVES with {ok:false, message} when the relay
    // rejects the event — it only throws on connection/timeout errors.
    const response = await relay.publish(signedEvent, { timeout });
    outbox.markRelayDone(signedEvent.id, relayUrl);
    if (response && response.ok === false) {
      console.warn(`Relay ${relayUrl} rejected event:`, response.message);
      return { relay: relayUrl, success: false, answered: true, error: response.message };
    }
    return { relay: relayUrl, success: true, answered: true };
  } catch (err) {
    console.warn(`Failed to publish to ${relayUrl}:`, /** @type {any} */ (err)?.message || err);
    return { relay: relayUrl, success: false, answered: false, error: err };
  }
}

/**
 * Rebroadcast events that must travel WITH a content event — a cover
 * image's kind-1063 license attestation next to the article or resource that
 * carries its hash in an `x` tag. The attestation was published on its own
 * when the license modal saved, to the author's outbox; this sends it to the
 * content's relay set too, so wherever the content is found the badge can
 * resolve, and gives it a second chance if that first publish was lost.
 *
 * `pool.publish` folds transport errors into `ok:false`, so a companion's
 * relay is cleared from the outbox only on `ok:true`.
 *
 * @param {import('nostr-tools').NostrEvent[]} companions
 * @param {string[]} relays
 * @param {number} timeout
 */
function publishCompanions(companions, relays, timeout) {
  for (const companion of companions) {
    if (!companion?.id) continue;
    outbox.enqueue({ event: companion, pending: relays });
    publishToRelays(companion, relays, { timeout, label: '[companion]' })
      .then(({ results }) => {
        for (const r of results) if (r.ok) outbox.markRelayDone(companion.id, r.from);
      })
      .catch((err) => console.warn('[companion] publish failed:', err));
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

  // Durable copy BEFORE the first await — see publish-outbox.js.
  outbox.enqueue({ event: signedEvent, taggedPubkeys, additionalRelays, communityEvent });

  const publishRelays = await computePublishRelays(signedEvent, taggedPubkeys, {
    communityEvent,
    additionalRelays
  });
  outbox.setPendingRelays(signedEvent.id, publishRelays);

  const results = await Promise.all(
    publishRelays.map((relayUrl) => publishToRelay(relayUrl, signedEvent, timeout))
  );
  const successCount = results.filter((r) => r.success).length;

  return {
    success: successCount > 0,
    relays: publishRelays,
    successCount,
    results
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
 * The version an event is about to replace, or undefined if there is none.
 *
 * Only meaningful for replaceable and addressable kinds — a regular event
 * replaces nothing, so there is nothing to put back if its publish fails.
 *
 * @param {import('nostr-tools').NostrEvent} signedEvent
 * @returns {import('nostr-tools').NostrEvent | undefined}
 */
function getReplacedVersion(signedEvent) {
  const { kind, pubkey, tags } = signedEvent;
  if (!isReplaceableKind(kind) && !isAddressableKind(kind)) return undefined;
  const identifier = isAddressableKind(kind)
    ? (tags.find((t) => t[0] === 'd')?.[1] ?? '')
    : undefined;
  try {
    return eventStore.getReplaceable(kind, pubkey, identifier);
  } catch {
    return undefined;
  }
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
 * @param {import('nostr-tools').NostrEvent[]} [opts.companions] - Already-signed events rebroadcast to the same relay set (e.g. the cover image's license attestation)
 * @returns {void} Returns immediately after adding to EventStore
 */
export function publishEventOptimistic(signedEvent, taggedPubkeys = [], opts = {}) {
  const {
    timeout = 5000,
    communityEvent = null,
    additionalRelays = [],
    onStatusChange,
    companions = []
  } = opts;

  // 0. Durable copy BEFORE anything else — see publish-outbox.js.
  outbox.enqueue({ event: signedEvent, taggedPubkeys, additionalRelays, communityEvent });

  // 1. Immediately add to EventStore for instant UI update.
  //
  // Capture the version this one replaces FIRST. Adding a replacement drops
  // its predecessor from the EventStore (keepOldVersions is off) and, once
  // the cache batch flushes, overwrites it in IDB too — nostr-idb keys
  // replaceable events by `kind:pubkey:d`. So by the time a total publish
  // failure is detected there is nothing left anywhere to fall back to, and
  // removing the phantom would leave the address EMPTY rather than restored.
  // This is the only moment the previous version is still reachable. (#64)
  const previousVersion = getReplacedVersion(signedEvent);
  eventStore.add(signedEvent);

  // 2. Initialize status
  /** @type {PublishStatus} */
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
    const publishRelays = await computePublishRelays(signedEvent, taggedPubkeys, {
      communityEvent,
      additionalRelays
    });
    outbox.setPendingRelays(signedEvent.id, publishRelays);
    status.totalRelays = publishRelays.length;
    status.status = 'publishing';
    notifyStatusUpdate({ ...status });
    onStatusChange?.({ ...status });

    publishCompanions(companions, publishRelays, timeout);

    // Publish to all relays, update status as each completes
    const results = await Promise.all(
      publishRelays.map(async (relayUrl) => {
        const result = await publishToRelay(relayUrl, signedEvent, timeout);
        if (result.success) {
          status.successCount++;
          // Mark as success on first successful publish
          status.status = 'success';
          notifyStatusUpdate({ ...status });
          onStatusChange?.({ ...status });
        }
        return result;
      })
    );

    // If no relays succeeded, mark as failed and remove from EventStore
    if (status.successCount === 0) {
      status.status = 'failed';
      status.error = 'Failed to publish to any relay';
      // A relay that never answered is still pending in the outbox and will
      // be retried on the next boot / reconnect. A relay that said no is not.
      status.retryQueued = results.some((r) => !r.answered);
      notifyStatusUpdate({ ...status });
      onStatusChange?.({ ...status });

      // Remove optimistically added event since publish failed completely
      eventStore.remove(signedEvent);

      // `eventStore.remove` only clears memory. The event was offered to the
      // IDB cache the moment it was added, and that pipeline is insert-only,
      // so without this the phantom outlives the failure — and for a
      // replaceable kind it OVERWRITES the last good version at its address
      // (nostr-idb keys by `kind:pubkey:d`), which a cache hit then serves
      // forever without asking a relay. Failure is detected only after
      // `Promise.allSettled` against a 5000ms timeout while the cache batches
      // at 1000ms. Measured in a browser by TestOER across four dead-relay
      // modes: the phantom is in IDB every time, and this delete is what turns
      // "renders fabricated data forever" into a cache miss. (#64)
      await uncacheEvent(signedEvent);

      // Put the replaced version back. Deleting the phantom on its own leaves
      // the address EMPTY, not restored: the predecessor was evicted from
      // memory when the replacement was added and overwritten in IDB when the
      // batch flushed. Empty is not stuck — a cache miss falls through to the
      // relays — but with the publish having just failed, the relays are
      // exactly what is not answering, so the user would see their content
      // vanish rather than revert.
      //
      // Ordering is load-bearing: this must run AFTER uncacheEvent, because
      // nostr-idb only writes a replaceable event when it is newer than the
      // entry at that address, and the phantom is newer than what it replaced.
      // Restoring first would be silently rejected.
      //
      // Two writes, because the memory restore does NOT imply the durable one.
      // `persistEventsToCache` drops anything carrying the from-cache marker,
      // and a predecessor that reached the app through `cacheRequest` carries
      // it — so on any normal page load (open app, open resource, edit) the
      // `eventStore.add` below is correctly reflected in the UI and silently
      // never reaches IDB, leaving the 404 this restore exists to prevent.
      // `recacheEvent` writes it directly. (#64)
      if (previousVersion && previousVersion.id !== signedEvent.id) {
        try {
          eventStore.add(previousVersion);
        } catch (err) {
          console.warn('Failed to restore the replaced event after a failed publish:', err);
        }
        await recacheEvent(previousVersion);
      }
    }
  })();
}

let outboxReplayStarted = false;

/**
 * Replay whatever the outbox still holds, now and on every reconnect.
 * Call once from the root layout after runtime config is ready (the relay
 * computation reads it). Idempotent; a no-op outside the browser.
 *
 * @returns {void}
 */
export function startPublishOutboxReplay() {
  if (outboxReplayStarted || typeof window === 'undefined') return;
  outboxReplayStarted = true;

  const replay = () =>
    outbox
      .replayOutbox({
        publish: async (event, relays) =>
          (await publishToRelays(event, relays, { label: '[outbox]' })).results,
        computeRelays: (entry) =>
          computePublishRelays(entry.event, entry.taggedPubkeys, {
            communityEvent: entry.communityEvent,
            additionalRelays: entry.additionalRelays
          }),
        // A failed optimistic publish rolled the event out of the store;
        // now that a relay has it, the UI may show it again.
        onDelivered: (event) => {
          try {
            eventStore.add(event);
          } catch {
            /* duplicate or superseded — nothing to show */
          }
        }
      })
      .then((s) => {
        if (s.replayed || s.dropped) console.info('[publish-outbox] replay', s);
      })
      .catch((err) => console.warn('[publish-outbox] replay failed', err));

  replay();
  window.addEventListener('online', replay);
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
