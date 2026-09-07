/**
 * Persistent publish outbox (issue fd042051).
 *
 * A signed event exists in exactly one place between signing and the first
 * relay OK: the tab's memory. The relay-list lookup that precedes every
 * outbox-model publish can take seconds, and nothing waits for the fan-out
 * to finish — so a closed tab, a stalled signer, or a dead relay set loses
 * the event for good while the EventStore (and the IDB cache) keep showing
 * it. That is how a license attestation ended up referenced by an article's
 * `x` tag without existing on any relay.
 *
 * This module is the durable side of that gap. `publish-service.js` hands
 * every event to `enqueue` BEFORE its first await, records the relay set
 * once computed, and clears each relay on a definitive answer (OK true, or
 * an explicit rejection — a relay that said no will say no again). What is
 * left pending is replayed on the next boot and whenever the browser comes
 * back online. Entries expire after `OUTBOX_MAX_AGE_MS` or
 * `OUTBOX_MAX_ATTEMPTS` replays so a permanently unreachable relay cannot
 * pin an event forever.
 *
 * Storage is raw IndexedDB — the event cache is nostr-idb, which keys
 * replaceable events by address and would silently collapse two pending
 * versions into one. Everything degrades to a no-op without IDB (SSR,
 * private windows that block storage) and all writes go through one serial
 * chain so fire-and-forget calls apply in call order.
 */
import { isEphemeralKind } from 'applesauce-core/helpers/event';
import { normalizeURL } from 'applesauce-core/helpers/url';

const DB_NAME = 'edufeed-publish-outbox';
const DB_VERSION = 1;
const STORE = 'entries';

/** Pending entries older than this are dropped on replay. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Replays per entry before it is dropped. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/**
 * @typedef {Object} OutboxEntry
 * @property {string} id - Event id (primary key)
 * @property {import('nostr-tools').NostrEvent} event - The signed event
 * @property {string[]} taggedPubkeys - p-tagged pubkeys (their read relays join the set)
 * @property {string[]} additionalRelays - Explicit extra relays
 * @property {import('nostr-tools').NostrEvent | null} communityEvent - Community definition when h-targeted
 * @property {string[] | null} pending - Relays still awaiting a definitive answer; null = not computed yet
 * @property {number} createdAt - ms epoch of enqueue
 * @property {number} attempts - Replays so far
 */

const hasIDB = () => typeof indexedDB !== 'undefined';

/**
 * Relay URLs are compared as strings, and the two sides come from different
 * places: the pending list holds what the relay helpers produced, while a
 * response's `from` is the pool's normalized URL (trailing slash, lowercase
 * host). Normalize everything that enters the store.
 * @param {string[]} relays
 * @returns {string[]}
 */
function normalizeAll(relays) {
  return [...new Set(relays.filter(Boolean).map((r) => normalizeURL(r)))];
}

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise;

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open must not poison every later call.
  dbPromise.catch(() => {
    dbPromise = undefined;
  });
  return dbPromise;
}

/**
 * Run one readwrite transaction against the store.
 * @template T
 * @param {(store: IDBObjectStore) => IDBRequest<T> | void} fn
 * @param {IDBTransactionMode} [mode]
 * @returns {Promise<T | undefined>}
 */
async function tx(fn, mode = 'readwrite') {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    /** @type {T | undefined} */
    let result;
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Serial write chain. The publish path calls enqueue → setPendingRelays →
 * markRelayDone without awaiting; IDB alone would not guarantee they land
 * in that order.
 */
let chain = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | undefined>}
 */
function serial(fn) {
  const run = chain.then(fn, fn).catch((err) => {
    console.warn('[publish-outbox] write failed', err);
    return undefined;
  });
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Persist a signed event and its publish inputs before the relay round trip.
 * Ephemeral kinds are skipped — replaying one later is meaningless.
 *
 * @param {{
 *   event: import('nostr-tools').NostrEvent,
 *   taggedPubkeys?: string[],
 *   additionalRelays?: string[],
 *   communityEvent?: import('nostr-tools').NostrEvent | null,
 *   pending?: string[] | null
 * }} input
 * @returns {Promise<void>}
 */
export async function enqueue(input) {
  if (!hasIDB()) return;
  const { event, taggedPubkeys = [], additionalRelays = [], communityEvent = null } = input;
  if (!event?.id || isEphemeralKind(event.kind)) return;
  /** @type {OutboxEntry} */
  const entry = {
    id: event.id,
    // Structured clone cannot carry Symbol-keyed relay provenance; strip it.
    event: JSON.parse(JSON.stringify(event)),
    taggedPubkeys: [...taggedPubkeys],
    additionalRelays: [...additionalRelays],
    communityEvent: communityEvent ? JSON.parse(JSON.stringify(communityEvent)) : null,
    pending: input.pending ? normalizeAll(input.pending) : null,
    createdAt: Date.now(),
    attempts: 0
  };
  await serial(() => tx((s) => s.put(entry)));
}

/**
 * Record the relay set an event is being published to.
 * @param {string} eventId
 * @param {string[]} relays
 * @returns {Promise<void>}
 */
export async function setPendingRelays(eventId, relays) {
  if (!hasIDB()) return;
  await serial(async () => {
    const entry = /** @type {OutboxEntry | undefined} */ (await tx((s) => s.get(eventId)));
    if (!entry) return;
    entry.pending = normalizeAll(relays);
    await tx((s) => s.put(entry));
  });
}

/**
 * A relay gave a definitive answer for this event. Drops the entry once no
 * relay is pending.
 * @param {string} eventId
 * @param {string} relay
 * @returns {Promise<void>}
 */
export async function markRelayDone(eventId, relay) {
  if (!hasIDB()) return;
  await serial(async () => {
    const entry = /** @type {OutboxEntry | undefined} */ (await tx((s) => s.get(eventId)));
    if (!entry) return;
    const done = normalizeURL(relay);
    entry.pending = (entry.pending ?? []).filter((r) => r !== done);
    if (entry.pending.length === 0) await tx((s) => s.delete(eventId));
    else await tx((s) => s.put(entry));
  });
}

/**
 * @param {string} eventId
 * @returns {Promise<void>}
 */
export async function removeEntry(eventId) {
  if (!hasIDB()) return;
  await serial(() => tx((s) => s.delete(eventId)));
}

/** @returns {Promise<OutboxEntry[]>} */
export async function listEntries() {
  if (!hasIDB()) return [];
  const rows = await serial(() => tx((s) => s.getAll(), 'readonly'));
  return /** @type {OutboxEntry[]} */ (rows ?? []);
}

/**
 * Replay every pending entry once.
 *
 * Injected collaborators keep this free of publish-service (which imports
 * this module): `publish(event, relays)` resolves to applesauce-style
 * `{ ok, from }` responses — a relay missing from the responses stays
 * pending; `computeRelays(entry)` fills in the set for entries whose
 * publish never got that far.
 *
 * @param {{
 *   publish: (event: import('nostr-tools').NostrEvent, relays: string[]) => Promise<{ ok: boolean, from: string }[]>,
 *   computeRelays?: (entry: OutboxEntry) => Promise<string[]>,
 *   onDelivered?: (event: import('nostr-tools').NostrEvent) => void,
 *   now?: number
 * }} deps
 * @returns {Promise<{ replayed: number, delivered: number, dropped: number }>}
 */
export async function replayOutbox({ publish, computeRelays, onDelivered, now = Date.now() }) {
  const summary = { replayed: 0, delivered: 0, dropped: 0 };
  const entries = await listEntries();
  for (const entry of entries) {
    if (now - entry.createdAt > OUTBOX_MAX_AGE_MS || entry.attempts >= OUTBOX_MAX_ATTEMPTS) {
      console.warn('[publish-outbox] giving up on', entry.event.kind, entry.id.slice(0, 8));
      await removeEntry(entry.id);
      summary.dropped++;
      continue;
    }

    let relays = entry.pending;
    if (!relays) {
      relays = computeRelays ? await computeRelays(entry) : [];
      if (relays.length === 0) {
        await removeEntry(entry.id);
        summary.dropped++;
        continue;
      }
      await setPendingRelays(entry.id, relays);
    }

    entry.attempts++;
    await serial(() => tx((s) => s.put({ ...entry, pending: relays })));
    summary.replayed++;

    try {
      const responses = await publish(entry.event, relays);
      let delivered = false;
      for (const r of responses ?? []) {
        if (!r?.from) continue;
        await markRelayDone(entry.id, r.from);
        if (r.ok) delivered = true;
      }
      if (delivered) {
        summary.delivered++;
        onDelivered?.(entry.event);
      }
    } catch (err) {
      console.warn('[publish-outbox] replay failed for', entry.id.slice(0, 8), err);
    }
  }
  return summary;
}

/** Test helper: close and delete the database. */
export async function deleteOutboxDb() {
  if (!hasIDB()) return;
  await chain;
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* already closed */
    }
    dbPromise = undefined;
  }
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
}
