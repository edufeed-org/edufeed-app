// Pure logic behind the relay-health surfaces (settings badges, the Termi
// "one of your relays is dead" hint). The reactive wiring and the network
// probe live in $lib/services/relay-health.js.
//
// A single failed probe means nothing — captive portals, a sleeping laptop,
// a relay restart. A relay only counts as dead for a while when this device
// saw it fail on separate days over several days and never saw it answer in
// between (nos.lol, 2026-10: unreachable for two weeks while still sitting in
// every signup's kind 10002).

export const DAY_MS = 86_400_000;

/** Minimum age of an unbroken failure streak before a relay counts as dead. */
export const DEAD_MIN_AGE_MS = 3 * DAY_MS;
/** Minimum number of distinct days with a failed probe in that streak. */
export const DEAD_MIN_FAILURE_DAYS = 2;

/**
 * @typedef {Object} RelayHealthRecord
 * @property {number} firstFailedAt - start of the current failure streak (0 = none)
 * @property {number} lastFailedAt
 * @property {number} lastSuccessAt
 * @property {string[]} failureDays - distinct UTC days (YYYY-MM-DD) in the streak
 */

/** @typedef {Record<string, RelayHealthRecord>} RelayHealthHistory */

/**
 * History key for a relay URL: case- and trailing-slash-insensitive, so
 * "wss://Nos.lol/" and "wss://nos.lol" (both spellings occur in kind 10002
 * lists) share one record. A path other than "/" is kept.
 * @param {string} url
 * @returns {string}
 */
export function relayKey(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

/** @param {number} ms */
function dayOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Fold one probe outcome into the history (returns a new object).
 * @param {RelayHealthHistory} history
 * @param {string} url
 * @param {boolean} ok - the relay answered (even an empty EOSE or a refusal)
 * @param {number} now - epoch ms
 * @returns {RelayHealthHistory}
 */
export function recordProbeOutcome(history, url, ok, now) {
  const key = relayKey(url);
  const prev = history[key] || {
    firstFailedAt: 0,
    lastFailedAt: 0,
    lastSuccessAt: 0,
    failureDays: []
  };
  /** @type {RelayHealthRecord} */
  const next = ok
    ? { firstFailedAt: 0, lastFailedAt: prev.lastFailedAt, lastSuccessAt: now, failureDays: [] }
    : {
        firstFailedAt: prev.firstFailedAt || now,
        lastFailedAt: now,
        lastSuccessAt: prev.lastSuccessAt,
        failureDays: prev.failureDays.includes(dayOf(now))
          ? prev.failureDays
          : [...prev.failureDays, dayOf(now)]
      };
  return { ...history, [key]: next };
}

/**
 * Relays of `urls` whose failure streak is long enough to call them dead.
 * Returns the URLs in the list's own spelling, with the streak age in days.
 *
 * @param {RelayHealthHistory} history
 * @param {string[]} urls - the relays of the user's kind 10002
 * @param {number} now
 * @param {{ minAgeMs?: number, minFailureDays?: number }} [opts]
 * @returns {Array<{url: string, days: number}>}
 */
export function findDeadRelays(history, urls, now, opts = {}) {
  const minAgeMs = opts.minAgeMs ?? DEAD_MIN_AGE_MS;
  const minFailureDays = opts.minFailureDays ?? DEAD_MIN_FAILURE_DAYS;
  /** @type {Array<{url: string, days: number}>} */
  const dead = [];
  for (const url of urls) {
    const r = history[relayKey(url)];
    if (!r || !r.firstFailedAt) continue;
    if (r.lastSuccessAt >= r.firstFailedAt) continue;
    const age = now - r.firstFailedAt;
    if (age < minAgeMs) continue;
    if (r.failureDays.length < minFailureDays) continue;
    dead.push({ url, days: Math.floor(age / DAY_MS) });
  }
  return dead;
}

/**
 * The first default relay that is neither in the user's list nor known dead.
 * @param {string[]} defaults - the deployment's default relay list
 * @param {string[]} currentUrls - relays in the user's kind 10002
 * @param {string[]} [excluded] - relays not to suggest (dead ones)
 * @returns {string | null}
 */
export function pickReplacementRelay(defaults, currentUrls, excluded = []) {
  const taken = new Set([...currentUrls, ...excluded].map(relayKey));
  return defaults.find((url) => !taken.has(relayKey(url))) ?? null;
}

/**
 * An edit of a kind 10002 with one relay swapped (or removed). Every tag that
 * is not the dead relay's r-tag is kept as-is, in order — a client must not
 * drop what it does not understand. A repeated dead r-tag (malformed lists
 * exist) is removed as a whole; the replacement appears once, with the first
 * occurrence's marker, and is skipped when it is already listed.
 *
 * @param {{kind?: number, content?: string, tags: string[][]}} event
 * @param {string} deadUrl
 * @param {string | null} replacementUrl
 * @returns {{kind: number, content: string, tags: string[][]}}
 */
export function replaceRelayInList(event, deadUrl, replacementUrl) {
  const dead = relayKey(deadUrl);
  const replacement = replacementUrl ? relayKey(replacementUrl) : null;
  const alreadyListed =
    !!replacement &&
    event.tags.some(
      (t) => t[0] === 'r' && relayKey(t[1]) === replacement && relayKey(t[1]) !== dead
    );
  let replaced = false;
  /** @type {string[][]} */
  const tags = [];
  for (const tag of event.tags) {
    if (tag[0] === 'r' && relayKey(tag[1]) === dead) {
      if (replacementUrl && !alreadyListed && !replaced) {
        replaced = true;
        tags.push([tag[0], replacementUrl, ...tag.slice(2)]);
      }
      continue;
    }
    tags.push([...tag]);
  }
  return { kind: 10002, content: event.content ?? '', tags };
}
