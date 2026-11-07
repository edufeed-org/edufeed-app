import { normalizeURL } from 'applesauce-core/helpers';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { cacheRequest } from '$lib/stores/event-cache.svelte.js';
import { fetchRelayListResolution, getDefaultRelays } from '$lib/services/relay-service.svelte.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

const COMMUNITIES_SET_ID = 'communities';

// How long relays get to answer. Past it, a still-silent write relay (or no
// answering app relay) makes the answer 'unknown'; silent lookup relays that
// are neither are ignored.
const PROBE_DEADLINE = 8_000;

/** @typedef {'found' | 'absent' | 'unknown'} FollowSetProbeResult */

/** @type {Map<string, Promise<FollowSetProbeResult>>} keyed by `kind:pubkey` */
const inflight = new Map();

/**
 * Find out whether the user's communities follow set (kind 30000,
 * d="communities") exists anywhere, and tell "nobody has it" apart from
 * "nobody answered".
 *
 * - 'found'   — it is in EventStore or IDB, or ANY relay delivered it (the
 *               event is added to EventStore on the way).
 * - 'absent'  — the relays that could hold it said so (see below).
 * - 'unknown' — anything less.
 *
 * Only 'absent' may license creating the list from scratch: a kind 30000 with
 * a newer created_at replaces the real one on every relay it reaches. The old
 * check treated a timeout as absence, so on a flaky connection one join
 * replaced a whole membership list with a single entry (2026-09-30).
 *
 * What counts as 'absent':
 * - The user's kind 10002 lookup must itself succeed (found, or confirmed
 *   missing). If it failed we don't even know where the list would live.
 * - Write relays (declared, or the defaults for users without a 10002) are
 *   where the list is published to. None of them may stay SILENT or send
 *   CLOSED, and at least one must answer EOSE. A relay whose connection
 *   outright fails counts as down rather than "maybe holding it" — otherwise
 *   one dead relay in a 10002 (common on Nostr) would block every first
 *   follow. Silence is the incident signature: half-dead sockets that never
 *   answer while the app otherwise seems fine.
 * - At least one of the app's communikey relays must answer EOSE. Requiring
 *   all would block first follows whenever one configured app relay is dead
 *   (dev.relay.edufeed.org stopped resolving the day this was written).
 *
 * Remaining gap: a write relay that is hard-down while holding the only copy.
 * Relay-side history of list kinds covers that; the client can't.
 *
 * Concurrent calls for the same pubkey share one probe.
 *
 * @param {string} pubkey
 * @returns {Promise<FollowSetProbeResult>}
 */
export function probeCommunitiesFollowSet(pubkey) {
  return singleFlight(`30000:${pubkey}`, () =>
    runProbe(pubkey, {
      kind: 30000,
      identifier: COMMUNITIES_SET_ID,
      appRelays: getAppRelaysForCategory('communikey')
    })
  );
}

/**
 * Same question for the user's kind 3 contact list, which applesauce's
 * FollowUser/UnfollowUser recreate from scratch when they don't see it within
 * a second. No app relay category holds kind 3: the write relays decide.
 *
 * @param {string} pubkey
 * @returns {Promise<FollowSetProbeResult>}
 */
export function probeContactList(pubkey) {
  return singleFlight(`3:${pubkey}`, () => runProbe(pubkey, { kind: 3, appRelays: [] }));
}

// How long a contact list confirmed against the network counts as current.
const CONTACTS_FRESH_FOR = 5 * 60_000;
const REFRESH_DEADLINE = 5_000;
/** @type {Map<string, number>} pubkey → when its kind 3 was last confirmed on a write relay */
const contactsConfirmedAt = new Map();

/**
 * Make the EventStore's kind 3 for `pubkey` current before something modifies
 * it. The store copy can be a stale one from the IDB cache (or a slow first
 * relay); FollowUser/UnfollowUser edit whatever is there, which drops follows
 * added in another client since. Asks the write relays + lookup relays once,
 * adds every answer (the store keeps the newest) and remembers the
 * confirmation for a few minutes.
 *
 * Passes when at least one write relay answered: with its list, or with an
 * empty EOSE (it holds nothing newer, so the store copy is the newest there
 * is). CLOSED, errors and silence don't count.
 *
 * @param {string} pubkey
 * @returns {Promise<boolean>} false when no write relay answered
 */
export async function refreshContactList(pubkey) {
  const confirmed = contactsConfirmedAt.get(pubkey);
  if (confirmed && Date.now() - confirmed < CONTACTS_FRESH_FOR) return true;

  const writeRelays = await resolveWriteRelays(pubkey);
  if (!writeRelays) return false;
  const all = new Set([...writeRelays, ...getAllLookupRelays().map(normalizeURL)]);
  const filter = { kinds: [3], authors: [pubkey] };

  const { answered } = await askEachRelay(all, filter, REFRESH_DEADLINE, false);
  const ok = [...writeRelays].some((url) => answered.has(url));
  if (ok) contactsConfirmedAt.set(pubkey, Date.now());
  return ok;
}

/**
 * Where the user's lists are published: their declared write relays, or the
 * defaults for a user confirmed to have no kind 10002. Null when the 10002
 * lookup itself failed.
 *
 * @param {string} pubkey
 * @returns {Promise<Set<string> | null>}
 */
async function resolveWriteRelays(pubkey) {
  const resolution = await fetchRelayListResolution(pubkey).catch(() => null);
  if (!resolution || resolution.outcome === 'unknown') return null;
  return new Set(
    (resolution.relayList?.writeRelays?.length
      ? resolution.relayList.writeRelays
      : getDefaultRelays()
    ).map(normalizeURL)
  );
}

/**
 * @param {string} key
 * @param {() => Promise<FollowSetProbeResult>} run
 */
function singleFlight(key, run) {
  const pending = inflight.get(key);
  if (pending) return pending;

  const probe = run().finally(() => inflight.delete(key));
  inflight.set(key, probe);
  return probe;
}

/**
 * @param {string} pubkey
 * @param {{ kind: number, identifier?: string, appRelays: string[] }} target
 * @returns {Promise<FollowSetProbeResult>}
 */
async function runProbe(pubkey, { kind, identifier, appRelays: targetAppRelays }) {
  const inStore = () => Boolean(eventStore.getReplaceable(kind, pubkey, identifier));
  if (inStore()) return 'found';

  /** @type {import('nostr-tools').Filter} */
  const filter = { kinds: [kind], authors: [pubkey] };
  if (identifier !== undefined) filter['#d'] = [identifier];

  const cached = await cacheRequest([filter]);
  for (const event of cached) eventStore.add(event);
  if (cached.length > 0 || inStore()) return 'found';

  const writeRelays = await resolveWriteRelays(pubkey);
  if (!writeRelays) return 'unknown';
  const appRelays = new Set(targetAppRelays.map(normalizeURL));
  const all = new Set([...writeRelays, ...appRelays, ...getAllLookupRelays().map(normalizeURL)]);

  const { found, answeredEmpty, unreachable } = await askEachRelay(
    all,
    filter,
    PROBE_DEADLINE,
    true
  );
  if (found) return 'found';
  const write = [...writeRelays];
  const writeOk =
    write.every((url) => answeredEmpty.has(url) || unreachable.has(url)) &&
    write.some((url) => answeredEmpty.has(url));
  const appOk = appRelays.size === 0 || [...appRelays].some((url) => answeredEmpty.has(url));
  return writeOk && appOk ? 'absent' : 'unknown';
}

/**
 * Ask each relay once for `filter` and add every event to the EventStore.
 * Settles when every relay is done (EOSE, CLOSED or error), at the deadline,
 * or — with `stopOnEvent` — at the first event.
 *
 * @param {Set<string>} urls
 * @param {import('nostr-tools').Filter} filter
 * @param {number} deadline
 * @param {boolean} stopOnEvent
 * @returns {Promise<{ found: boolean, answered: Set<string>, answeredEmpty: Set<string>, unreachable: Set<string> }>}
 *   answered = relays that sent an EVENT or EOSE; answeredEmpty = EOSE without an event
 */
function askEachRelay(urls, filter, deadline, stopOnEvent) {
  return new Promise((resolve) => {
    /** @type {Set<string>} */
    const answered = new Set();
    /** @type {Set<string>} */
    const withEvent = new Set();
    /** @type {Set<string>} */
    const unreachable = new Set();
    /** @type {Set<string>} */
    const done = new Set();
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Deferred: a relay can answer synchronously inside subscribe(), before
      // its subscription is pushed.
      queueMicrotask(() => subs.forEach((s) => s.unsubscribe()));
      const answeredEmpty = new Set([...answered].filter((url) => !withEvent.has(url)));
      resolve({ found: withEvent.size > 0, answered, answeredEmpty, unreachable });
    };

    const markDone = (/** @type {string} */ url) => {
      done.add(url);
      if (done.size === urls.size) settle();
    };

    const timer = setTimeout(settle, deadline);

    for (const url of urls) {
      if (settled) break;
      subs.push(
        pool
          .relay(url)
          // Raw req(): one attempt, no reconnect retries — a dead relay
          // should fail inside the deadline, not look silent.
          .req(filter)
          .subscribe({
            next: (/** @type {import('applesauce-relay').RelayReqMessage} */ msg) => {
              if (msg.type === 'EVENT') {
                eventStore.add(msg.event);
                answered.add(url);
                withEvent.add(url);
                if (stopOnEvent) settle();
              } else if (msg.type === 'EOSE') {
                answered.add(url);
                markDone(url);
              } else if (msg.type === 'CLOSED') {
                markDone(url);
              }
            },
            error: () => {
              unreachable.add(url);
              markDone(url);
            }
          })
      );
    }
  });
}
