/**
 * NIP-85 trusted assertions (kind 30382) — web-of-trust scores a provider
 * (Brainstorm's house key by default, see TRUST_ASSERTION_PROVIDERS)
 * publishes about other pubkeys: rank (0-100), hops from the observer,
 * verified follower / muter / reporter counts.
 *
 * The app uses them to ORDER and ANNOTATE people-picker results, never to
 * hide anyone: a teacher who joined Nostr yesterday has no assertion from
 * any provider and must stay findable. Everything degrades to "no score":
 * relay down, provider silent, config empty — the picker is unchanged.
 *
 * Three layers:
 *   - parseTrustAssertion: pure, event → TrustScore | null
 *   - trustAssertionsLoader: batch REQ to the scores relays, feeds EventStore
 *   - the score cache below: ask-once per subject, newest assertion wins,
 *     `trustScoreUpdates` fires so useTrustScores() can re-render.
 */
import { Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getTrustAssertionRelays, getTrustAssertionProviders } from '$lib/helpers/relay-helper.js';

const KIND = 30382;
const HEX64 = /^[0-9a-f]{64}$/i;
const REQUEST_TIMEOUT_MS = 4000;
/** Relays cap `#d` lists; 100 subjects per REQ keeps well under any limit. */
const BATCH_SIZE = 100;

/**
 * @typedef {{
 *   pubkey: string,
 *   provider: string,
 *   createdAt: number,
 *   rank: number | null,
 *   hops: number | null,
 *   followers: number | null,
 *   muters: number | null,
 *   reporters: number | null
 * }} TrustScore
 */

/**
 * @param {any} event
 * @param {string} name
 * @returns {number | null}
 */
function intTag(event, name) {
  const raw = event.tags.find((/** @type {string[]} */ t) => t[0] === name)?.[1];
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {any} event
 * @returns {TrustScore | null}
 */
export function parseTrustAssertion(event) {
  if (!event || event.kind !== KIND || !Array.isArray(event.tags)) return null;
  const subject = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
  if (typeof subject !== 'string' || !HEX64.test(subject)) return null;
  return {
    pubkey: subject.toLowerCase(),
    provider: event.pubkey,
    createdAt: event.created_at,
    rank: intTag(event, 'rank'),
    hops: intTag(event, 'hops'),
    followers: intTag(event, 'followers'),
    muters: intTag(event, 'muters'),
    reporters: intTag(event, 'reporters')
  };
}

/**
 * Fetch the configured providers' assertions about `pubkeys`.
 * @param {Iterable<string>} pubkeys - subjects (hex); anything else is dropped
 * @returns {Observable<import('nostr-tools').Event>}
 */
export function trustAssertionsLoader(pubkeys) {
  const relays = getTrustAssertionRelays();
  const providers = getTrustAssertionProviders();
  const subjects = [
    ...new Set([...pubkeys].filter((pk) => typeof pk === 'string' && HEX64.test(pk)))
  ];
  if (relays.length === 0 || providers.length === 0 || subjects.length === 0) {
    return new Observable((subscriber) => subscriber.complete());
  }
  return new Observable((subscriber) => {
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    let pending = 0;
    for (let i = 0; i < subjects.length; i += BATCH_SIZE) {
      pending++;
      const filter = { kinds: [KIND], authors: providers, '#d': subjects.slice(i, i + BATCH_SIZE) };
      subs.push(
        pool
          .request(relays, filter, /** @type {any} */ ({ timeout: REQUEST_TIMEOUT_MS }))
          .pipe(tap((event) => eventStore.add(event)))
          .subscribe({
            next: (event) => subscriber.next(event),
            error: (err) => subscriber.error(err),
            complete: () => {
              if (--pending === 0) subscriber.complete();
            }
          })
      );
    }
    return () => subs.forEach((s) => s.unsubscribe());
  });
}

// ---- score cache --------------------------------------------------------

/** @type {Map<string, TrustScore>} */
const scores = new Map();
/** Subjects already requested this session (ask-once, like useAuthorDeletions). */
const asked = new Set();
/** Fires after each cache write; payload is the subject pubkey. */
export const trustScoreUpdates = new Subject();

/**
 * @param {string} pubkey
 * @returns {TrustScore | undefined}
 */
export function getTrustScore(pubkey) {
  return scores.get(pubkey);
}

/**
 * Request scores for subjects not asked about yet. Fire-and-forget: results
 * land in the cache and `trustScoreUpdates`; errors are swallowed.
 * @param {Iterable<string>} pubkeys
 */
export function requestTrustScores(pubkeys) {
  const providers = new Set(getTrustAssertionProviders());
  /** @type {string[]} */
  const fresh = [];
  for (const pk of pubkeys) {
    if (typeof pk !== 'string' || !HEX64.test(pk) || asked.has(pk)) continue;
    asked.add(pk);
    fresh.push(pk);
  }
  if (fresh.length === 0) return;
  trustAssertionsLoader(fresh).subscribe({
    next: (event) => {
      if (!providers.has(event.pubkey)) return;
      const score = parseTrustAssertion(event);
      if (!score) return;
      const current = scores.get(score.pubkey);
      if (current && current.createdAt > score.createdAt) return;
      scores.set(score.pubkey, score);
      trustScoreUpdates.next(score.pubkey);
    },
    error: () => {}
  });
}
