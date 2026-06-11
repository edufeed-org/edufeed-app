import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Reactive lookup of the best kind 1063 license event for a SHA-256 hash.
 *
 * Fires a `createTimelineLoader` to pull matching events into EventStore,
 * then subscribes to `eventStore.timeline(...)` for reactive updates. Returns
 * a getter that yields the newest event by `created_at`, ties broken by lex
 * order of `id`.
 *
 * Tolerates `getHash()` returning `null` or an empty string — in that case
 * the getter returns `null` and no loader is fired.
 *
 * @param {() => string | null | undefined} getHash
 * @returns {() => import('nostr-tools').NostrEvent | null}
 */
export function useLicenseForHash(getHash) {
  let current = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));

  $effect(() => {
    const hash = getHash();
    if (!hash) {
      current = null;
      return;
    }

    const filter = { kinds: [1063], '#x': [hash], limit: 50 };
    const loader = createTimelineLoader(timedPool, getAllLookupRelays(), filter, {
      eventStore,
      limit: 50
    });
    const loaderSub = loader().subscribe({ error: () => {} });
    const storeSub = eventStore.timeline(filter).subscribe((events) => {
      if (!events || events.length === 0) {
        current = null;
        return;
      }
      // Newest first by created_at; tie-break by id ascending for determinism.
      const sorted = [...events].sort((a, b) => {
        if (b.created_at !== a.created_at) return b.created_at - a.created_at;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      current = sorted[0];
    });

    return () => {
      loaderSub.unsubscribe();
      storeSub.unsubscribe();
    };
  });

  return () => current;
}
