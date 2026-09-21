/**
 * Reactive hook: NIP-85 trust scores (kind 30382, see
 * loaders/trust-assertions.js) for a reactive collection of pubkeys.
 *
 * Same contract as useProfileMap — returns a getter for a `Map<pubkey,
 * TrustScore>` that re-renders when a score arrives — and the same ask-once
 * rule as useAuthorDeletions: the people-picker rebuilds its list on every
 * keystroke, and one REQ per keystroke is what starves a relay connection.
 * Scores never un-happen within a session, so a subject is requested once.
 *
 * MUST be called during component init (it uses $effect).
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- plain Map snapshots, replaced wholesale */
import {
  requestTrustScores,
  getTrustScore,
  trustScoreUpdates
} from '$lib/loaders/trust-assertions.js';

/**
 * @param {() => Iterable<string>} getPubkeys - reactive getter for the pubkeys on screen
 * @returns {() => Map<string, import('$lib/loaders/trust-assertions.js').TrustScore>}
 */
export function useTrustScores(getPubkeys) {
  /** @type {Set<string>} current subjects (plain — read inside the subscription) */
  let current = new Set();
  let scores = $state(/** @type {Map<string, any>} */ (new Map()));
  /** Plain mirror of `scores` for the change check — reading the $state Map
   *  inside the pubkey effect would make that effect re-run on its own write. */
  let published = new Map();

  // Identity-stable: only publish a new Map when an entry actually changed.
  // The consumer's re-sort effect reads this Map and rewrites its row list,
  // which feeds back into getPubkeys() — a fresh Map per pass would loop
  // (effect_update_depth_exceeded, the dropdown froze mid-word).
  function snapshot() {
    const next = new Map();
    for (const pk of current) {
      const score = getTrustScore(pk);
      if (score) next.set(pk, score);
    }
    if (next.size === published.size && [...next].every(([pk, v]) => published.get(pk) === v)) {
      return;
    }
    published = next;
    scores = next;
  }

  $effect(() => {
    const pubkeys = [...(getPubkeys() ?? [])].filter((pk) => typeof pk === 'string');
    current = new Set(pubkeys);
    requestTrustScores(pubkeys);
    snapshot();
  });

  $effect(() => {
    const sub = trustScoreUpdates.subscribe((pubkey) => {
      if (current.has(pubkey)) snapshot();
    });
    return () => sub.unsubscribe();
  });

  return () => scores;
}
