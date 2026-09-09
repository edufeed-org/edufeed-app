// Bounded race for a relay's NIP-11 signing key, shared by every place that
// must decide "pin this kind:39000 request, or ask unpinned" — the
// community rail (channel-metadata.svelte.js) and the directory
// (relay-directory.svelte.js) both had their own copy of this gap
// independently: an effect read the relay's (possibly still-empty) NIP-11
// authors and fired a request immediately, with no bounded wait for a
// relay that would answer NIP-11 a beat later. Measured: a forged
// kind:39000 collected — and rendered — in that gap on an honest, keyed
// relay before its own NIP-11 answer ever arrived
// (DOOR3_COMMUNITY_METADATA_TRUST.md). Same constant, same reasoning as
// armada's NIP11_RACE_MS (nip29.ts:28).
//
// This module is plain (no runes) on purpose: callers with different
// reactive shapes (one relay vs. many) wire it into their own effects
// rather than sharing a hook that would have to guess which shape they
// need.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { relayMetadataAuthors } from './relay-directory.js';

export const NIP11_RACE_MS = 2_000;

/**
 * Races one relay's NIP-11 document against the bounded window above.
 *
 * `onAuthors` may fire more than once — every time NIP-11 answers,
 * including after the window has already expired — so a relay that
 * resolves its key late still gets its pinned request eventually (the
 * caller's own reactive effect re-running on the updated authors is what
 * performs that correction; this module only supplies the value and the
 * timing). `onReady` fires exactly once: on the first NIP-11 answer
 * (with or without a key), on a NIP-11 error (no key to wait for, same
 * conclusion the window would reach on timeout, just immediate), or when
 * the window expires with no answer at all.
 *
 * @param {string} relay
 * @param {{onAuthors: (authors: string[]) => void, onReady: () => void}} handlers
 * @returns {() => void} teardown
 */
export function raceRelayKey(relay, { onAuthors, onReady }) {
  let ready = false;
  const markReady = () => {
    if (ready) return;
    ready = true;
    onReady();
  };
  const sub = pool.relay(relay).information$.subscribe({
    next: (/** @type {any} */ info) => {
      onAuthors(relayMetadataAuthors(info));
      markReady();
    },
    error: () => markReady()
  });
  const timer = setTimeout(markReady, NIP11_RACE_MS);
  return () => {
    sub.unsubscribe();
    clearTimeout(timer);
  };
}
