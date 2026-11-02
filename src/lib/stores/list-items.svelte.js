/**
 * useListItems — the items of a NIP-51 list or set (its public `e` and `a`
 * tags), store first.
 *
 * Every item is watched in the EventStore by identity, so whatever arrives —
 * from the loads below or any other surface — shows up at once. Items the
 * store does not hold are loaded through `loadReferencedEvent` (the tag's
 * relay hint + the lookup relays, then the author's NIP-65 outboxes), with
 * `retryWhilePending` re-asking for the ones still missing.
 *
 * All loads start in the same tick as the store subscriptions, so the
 * loaders consolidate them with the store's own fallback lookups into one
 * batch per relay set. The views this replaced ran a separate fetchEvents
 * beside it — every item asked twice — and never retried a miss.
 *
 * Call during component initialisation.
 */
import { merge } from 'rxjs';
import { getEventPointersFromList, getAddressPointersFromList } from 'applesauce-common/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';
import { loadReferencedEvent } from '$lib/loaders/referenced-event.js';
import { retryWhilePending, RETRY_DELAYS_MS } from '$lib/helpers/retry-while-pending.js';

/**
 * Key of an `a` item, as the list views order and look them up.
 * @param {{ kind: number, pubkey: string, identifier?: string }} pointer
 */
export function addressItemKey(pointer) {
  return `a:${pointer.kind}:${pointer.pubkey}:${pointer.identifier ?? ''}`;
}

/**
 * @param {() => import('nostr-tools').NostrEvent | null | undefined} getList
 * @param {{ retryDelaysMs?: number[] }} [options]
 */
export function useListItems(getList, { retryDelaysMs = RETRY_DELAYS_MS } = {}) {
  // $state.raw snapshots, replaced whole on every change (Nostr events carry
  // Symbol-based provenance; a reactive SvelteMap would proxy nothing useful).
  /** @type {Map<string, import('nostr-tools').NostrEvent>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- immutable snapshot
  let items = $state.raw(new Map());

  $effect(() => {
    const list = getList();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- immutable snapshot
    items = new Map();
    if (!list) return;

    // Called here, not in a $derived: applesauce caches the parsed pointers
    // on the event (a mutation Svelte forbids inside deriveds).
    const lookupRelays = getAllLookupRelays();
    const refs = [
      ...getEventPointersFromList(list).map((p) => ({
        key: 'e:' + p.id,
        identity: { id: p.id },
        relays: p.relays,
        author: p.author
      })),
      ...getAddressPointersFromList(list).map((p) => {
        const identity = { kind: p.kind, pubkey: p.pubkey, identifier: p.identifier ?? '' };
        return { key: addressItemKey(identity), identity, relays: p.relays, author: undefined };
      })
    ];

    /** @type {Map<string, import('nostr-tools').NostrEvent>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to $effect; published as snapshots
    const found = new Map();
    const subs = refs.map((ref) =>
      eventStore.event(/** @type {any} */ (ref.identity)).subscribe((event) => {
        if (!event) return;
        found.set(ref.key, event);
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- immutable snapshot
        items = new Map(found);
      })
    );

    const missing = () => refs.filter((ref) => !found.has(ref.key));
    const stopLoading = retryWhilePending(
      () =>
        merge(
          ...missing().map((ref) =>
            loadReferencedEvent(
              /** @type {any} */ ({
                ...ref.identity,
                relays: unique([...(ref.relays ?? []), ...lookupRelays])
              }),
              { author: ref.author }
            )
          )
        ),
      () => missing().length > 0,
      retryDelaysMs
    );

    return () => {
      for (const sub of subs) sub.unsubscribe();
      stopLoading();
    };
  });

  return {
    /** Loaded items by key: `e:<id>` / `a:<kind>:<pubkey>:<d>` (see addressItemKey). */
    get items() {
      return items;
    }
  };
}
