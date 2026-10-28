/**
 * Relay health probe for the user's own kind 10002 (NIP-65) relays.
 *
 * One REQ per relay for the user's own relay list: completing (EOSE) proves
 * the relay is reachable and tells whether it holds the list — NIP-65 wants
 * the kind 10002 on every relay it names, so a listed relay without it is
 * worth a badge. A refusal (auth-required, restricted) is reachability too.
 * Only a transport failure is 'unreachable'; a deadline with no answer at all
 * is 'timeout' and no evidence either way (sleeping tab, flaky Wi-Fi). The
 * request goes through `pool.relay(url)` so the liveness tracker's parking
 * never hides a relay from its own health check.
 *
 * Outcomes are folded into a per-device history in localStorage (relay
 * reachability is a property of this device's network, not of the account),
 * which the pure helpers turn into "dead for N days" — see
 * $lib/helpers/relay-health.js for the thresholds.
 */
import { lastValueFrom, timeout as rxTimeout, TimeoutError } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { recordProbeOutcome } from '$lib/helpers/relay-health.js';

export const RELAY_HEALTH_STORAGE_KEY = 'relay-health-history:v1';

/** Default per-relay deadline. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @typedef {Object} RelayProbeResult
 * @property {string} url
 * @property {'ok' | 'unreachable' | 'timeout'} status
 * @property {boolean} holdsList - the relay returned the user's kind 10002
 * @property {number | null} rttMs - time to completion (ok only)
 * @property {any} info - NIP-11 document, or null
 */

/** Reachable-but-refusing replies: the relay is alive, it just said no. */
const REFUSAL = /auth-required|restricted|blocked|rate-limited|pow:/i;

/** @param {any} err */
function errorMessages(err) {
  /** @type {string[]} */
  const out = [];
  if (!err) return out;
  if (typeof err.message === 'string') out.push(err.message);
  // applesauce RelayGroupError: per-relay outcomes keyed by URL
  const outcomes = err.outcomes;
  if (outcomes && typeof outcomes === 'object') {
    for (const o of Object.values(outcomes)) {
      const cause = /** @type {any} */ (o)?.error;
      if (cause && typeof cause.message === 'string') out.push(cause.message);
    }
  }
  return out;
}

/**
 * Fetch the relay's NIP-11 document (applesauce caches it); null on any failure.
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchInfo(url, timeoutMs) {
  try {
    const relay = pool.relay(url);
    const doc = await Promise.race([
      relay.getInformation(),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
    return doc ?? null;
  } catch {
    return null;
  }
}

/**
 * Probe one relay for the user's own kind 10002.
 * @param {string} url
 * @param {string} pubkey
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<RelayProbeResult>}
 */
export async function probeRelay(url, pubkey, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const infoPromise = fetchInfo(url, timeoutMs);
  /** @type {RelayProbeResult} */
  let result;
  try {
    const events = await lastValueFrom(
      // pool.relay(url).request — never the pool-level request: the pool skips
      // relays the liveness tracker has parked, and a skipped relay would
      // complete empty and read as "reachable, no list".
      pool
        .relay(url)
        .request({ kinds: [10002], authors: [pubkey], limit: 1 })
        .pipe(toArray(), rxTimeout(timeoutMs)),
      { defaultValue: [] }
    );
    result = {
      url,
      status: 'ok',
      holdsList: events.some((e) => e?.kind === 10002 && e?.pubkey === pubkey),
      rttMs: Date.now() - started,
      info: null
    };
  } catch (err) {
    const status =
      err instanceof TimeoutError
        ? 'timeout'
        : errorMessages(err).some((msg) => REFUSAL.test(msg))
          ? 'ok'
          : 'unreachable';
    result = {
      url,
      status,
      holdsList: false,
      rttMs: status === 'ok' ? Date.now() - started : null,
      info: null
    };
  }
  result.info = await infoPromise;
  return result;
}

/**
 * Probe several relays in parallel.
 * @param {string[]} urls
 * @param {string} pubkey
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Map<string, RelayProbeResult>>}
 */
export async function probeRelays(urls, pubkey, opts = {}) {
  const results = await Promise.all(urls.map((url) => probeRelay(url, pubkey, opts)));
  return new Map(results.map((r) => [r.url, r]));
}

/** @typedef {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void }} StorageLike */

/** @returns {StorageLike | null} */
function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * @param {StorageLike | null} [storage]
 * @returns {import('$lib/helpers/relay-health.js').RelayHealthHistory}
 */
export function loadRelayHealthHistory(storage = defaultStorage()) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(RELAY_HEALTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param {import('$lib/helpers/relay-health.js').RelayHealthHistory} history
 * @param {StorageLike | null} [storage]
 */
export function saveRelayHealthHistory(history, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(RELAY_HEALTH_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // quota / private mode — the history is a convenience, not state
  }
}

/**
 * Probe the relays and fold the outcomes into the persisted history.
 * Timeouts are not recorded: they are not evidence of anything.
 *
 * @param {string[]} urls
 * @param {string} pubkey
 * @param {{ timeoutMs?: number, now?: number, storage?: StorageLike | null }} [opts]
 * @returns {Promise<{ results: Map<string, RelayProbeResult>, history: import('$lib/helpers/relay-health.js').RelayHealthHistory }>}
 */
export async function probeAndRecord(urls, pubkey, opts = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const results = await probeRelays(urls, pubkey, { timeoutMs: opts.timeoutMs });
  const now = opts.now ?? Date.now();
  let history = loadRelayHealthHistory(storage);
  for (const r of results.values()) {
    if (r.status === 'timeout') continue;
    history = recordProbeOutcome(history, r.url, r.status === 'ok', now);
  }
  saveRelayHealthHistory(history, storage);
  return { results, history };
}
