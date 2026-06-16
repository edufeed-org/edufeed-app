import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Reactive license-resolution status for an image, keyed by SHA-256 hash.
 *
 * Returns a getter yielding `{ event, status }`:
 *   - status 'loading' — still resolving from relays (render nothing yet)
 *   - status 'found'   — a kind-1063 license event exists (newest-wins)
 *   - status 'missing' — no hash OR loader settled with no event
 *
 * No hash → 'missing' immediately (external/no-hash images can't be looked up).
 * With a hash, we stay 'loading' until the loader completes OR a 2.5s timeout,
 * whichever comes first. A store hit always wins immediately.
 *
 * @param {() => string | null | undefined} getHash
 * @returns {() => { event: import('nostr-tools').NostrEvent | null, status: 'loading' | 'found' | 'missing' }}
 */
export function useLicenseStatus(getHash) {
  let state = $state(
    /** @type {{ event: import('nostr-tools').NostrEvent | null, status: 'loading' | 'found' | 'missing' }} */ ({
      event: null,
      status: 'loading'
    })
  );

  $effect(() => {
    const hash = getHash();
    if (!hash) {
      state = { event: null, status: 'missing' };
      return;
    }

    state = { event: null, status: 'loading' };
    let settled = false;
    /** @type {import('nostr-tools').NostrEvent | null} */
    let latest = null;

    const settle = () => {
      if (settled) return;
      settled = true;
      state = latest ? { event: latest, status: 'found' } : { event: null, status: 'missing' };
    };

    const filter = { kinds: [1063], '#x': [hash], limit: 50 };
    const loader = createTimelineLoader(timedPool, getAllLookupRelays(), filter, {
      eventStore,
      limit: 50
    });
    const loaderSub = loader().subscribe({ complete: settle, error: settle });

    const storeSub = eventStore.timeline(filter).subscribe((events) => {
      if (events && events.length > 0) {
        // Newest first by created_at; tie-break by id ascending for determinism.
        const sorted = [...events].sort((a, b) => {
          if (b.created_at !== a.created_at) return b.created_at - a.created_at;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        latest = sorted[0];
        settled = true; // a hit wins immediately, regardless of loader timing
        state = { event: latest, status: 'found' };
      } else {
        latest = null;
        if (settled) state = { event: null, status: 'missing' };
      }
    });

    const timeoutId = setTimeout(settle, 2500);

    return () => {
      clearTimeout(timeoutId);
      loaderSub.unsubscribe();
      storeSub.unsubscribe();
    };
  });

  return () => state;
}

/**
 * Back-compat wrapper: yields just the license event (or null), ignoring status.
 * @param {() => string | null | undefined} getHash
 * @returns {() => import('nostr-tools').NostrEvent | null}
 */
export function useLicenseForHash(getHash) {
  const getStatus = useLicenseStatus(getHash);
  return () => getStatus().event;
}
