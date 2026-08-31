// The relay's NIP-11 document, reactively.
//
// applesauce's Relay already fetches and caches it (`information$`), so this
// is only the rune bridge — no fetcher of our own, no second cache.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * @param {() => string | null | undefined} getRelay
 * @returns {() => any} the NIP-11 document, or null until it arrives
 */
export function useRelayInformation(getRelay) {
  // $state.raw: the document is an external object and nothing here mutates
  // it; deep proxying would only cost, and a fresh object per emission keeps
  // reassignment reactive.
  /** @type {any} */
  let information = $state.raw(null);

  $effect(() => {
    const relay = getRelay();
    // Clear first: a relay that never answers must not keep showing the
    // previous relay's badges.
    information = null;
    if (!relay) return;
    const sub = pool.relay(relay).information$.subscribe({
      next: (/** @type {any} */ doc) => (information = doc ?? null),
      // A relay that refuses NIP-11 simply has no badges — never an error
      // surface, the chat below it works either way.
      error: () => (information = null)
    });
    return () => sub.unsubscribe();
  });

  return () => information;
}
