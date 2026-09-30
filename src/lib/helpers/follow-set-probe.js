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

/** @type {Map<string, Promise<FollowSetProbeResult>>} */
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
  const pending = inflight.get(pubkey);
  if (pending) return pending;

  const probe = runProbe(pubkey).finally(() => inflight.delete(pubkey));
  inflight.set(pubkey, probe);
  return probe;
}

/**
 * @param {string} pubkey
 * @returns {Promise<FollowSetProbeResult>}
 */
async function runProbe(pubkey) {
  const inStore = () => Boolean(eventStore.getReplaceable(30000, pubkey, COMMUNITIES_SET_ID));
  if (inStore()) return 'found';

  const filter = { kinds: [30000], authors: [pubkey], '#d': [COMMUNITIES_SET_ID] };

  const cached = await cacheRequest([filter]);
  for (const event of cached) eventStore.add(event);
  if (cached.length > 0 || inStore()) return 'found';

  const resolution = await fetchRelayListResolution(pubkey).catch(() => null);
  if (!resolution || resolution.outcome === 'unknown') return 'unknown';
  const writeRelays = new Set(
    (resolution.relayList?.writeRelays?.length
      ? resolution.relayList.writeRelays
      : getDefaultRelays()
    ).map(normalizeURL)
  );
  const appRelays = new Set(getAppRelaysForCategory('communikey').map(normalizeURL));
  const all = new Set([...writeRelays, ...appRelays, ...getAllLookupRelays().map(normalizeURL)]);

  return new Promise((resolve) => {
    /** @type {Set<string>} */
    const answeredEmpty = new Set();
    /** @type {Set<string>} */
    const unreachable = new Set();
    /** @type {Set<string>} */
    const done = new Set();
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    let settled = false;

    const settle = (/** @type {FollowSetProbeResult} */ result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Deferred: a relay can answer synchronously inside subscribe(), before
      // its subscription is pushed.
      queueMicrotask(() => subs.forEach((s) => s.unsubscribe()));
      resolve(result);
    };

    const verdict = () => {
      const write = [...writeRelays];
      const writeOk =
        write.every((url) => answeredEmpty.has(url) || unreachable.has(url)) &&
        write.some((url) => answeredEmpty.has(url));
      const appOk = appRelays.size === 0 || [...appRelays].some((url) => answeredEmpty.has(url));
      return writeOk && appOk ? 'absent' : 'unknown';
    };

    const markDone = (/** @type {string} */ url) => {
      done.add(url);
      if (done.size === all.size) settle(verdict());
    };

    const timer = setTimeout(() => settle(verdict()), PROBE_DEADLINE);

    for (const url of all) {
      if (settled) break;
      subs.push(
        pool
          .relay(url)
          // No reconnect retries: a dead relay should fail inside the
          // deadline, not look silent.
          .req(filter, { reconnect: false })
          .subscribe({
            next: (/** @type {import('applesauce-relay').RelayReqMessage} */ msg) => {
              if (msg.type === 'EVENT') {
                eventStore.add(msg.event);
                settle('found');
              } else if (msg.type === 'EOSE') {
                answeredEmpty.add(url);
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
