/**
 * Reactive loader for a single replaceable Nostr event by address pointer.
 *
 * Replaces the SvelteKit-load `fetchEventById()` pattern that 404s on slow
 * relays. The hook subscribes to `eventStore.replaceable(kind, pubkey, identifier)`
 * (so warm-cache visits render instantly) and fires `addressLoader(pointer)`
 * to pull from relays. After NOT_FOUND_DELAY_MS without an event, flips
 * `notFound = true` so the page can show a useful message instead of a
 * permanent spinner. If the event eventually arrives, notFound clears.
 *
 * Uses $state.raw for `event` because Nostr events carry Symbol-based relay
 * provenance metadata that the Svelte 5 deep-proxy would break.
 *
 * @typedef {Object} ReplaceableEventPointer
 * @property {number} kind
 * @property {string} pubkey
 * @property {string} [identifier]
 * @property {string[]} [relays]
 */

import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';

const DEFAULT_NOT_FOUND_DELAY_MS = 10_000;

/**
 * @param {() => (ReplaceableEventPointer | null | undefined)} getPointer
 * @param {{ notFoundDelayMs?: number }} [options]
 * @returns {() => { event: any, loading: boolean, notFound: boolean }}
 */
export function useReplaceableEvent(getPointer, options = {}) {
  const notFoundDelayMs = options.notFoundDelayMs ?? DEFAULT_NOT_FOUND_DELAY_MS;

  let event = $state.raw(/** @type {any} */ (undefined));
  let loading = $state(true);
  let notFound = $state(false);

  $effect(() => {
    const pointer = getPointer();
    if (!pointer || typeof pointer.kind !== 'number' || !pointer.pubkey) {
      event = undefined;
      loading = false;
      notFound = false;
      return;
    }

    event = undefined;
    loading = true;
    notFound = false;

    const loaderSub = addressLoader(pointer).subscribe({
      // Errors from the network are not fatal — we rely on the store
      // subscription + timeout for state. Swallow to avoid unhandled errors.
      error: () => {}
    });

    const storeSub = eventStore
      .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
      .subscribe((e) => {
        if (e) {
          event = e;
          loading = false;
          notFound = false;
        }
      });

    const timer = setTimeout(() => {
      if (!event) {
        notFound = true;
        loading = false;
      }
    }, notFoundDelayMs);

    return () => {
      clearTimeout(timer);
      loaderSub.unsubscribe();
      storeSub.unsubscribe();
    };
  });

  return () => ({ event, loading, notFound });
}
