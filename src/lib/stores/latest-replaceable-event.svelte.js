/**
 * Reactive hook: keep a detail page on the NEWEST revision of one addressable
 * event, and say when its author deleted it.
 *
 * Why a route's `load()` snapshot is not enough (calendar event detail): the
 * snapshot comes from `fetchEventById`, which returns the EventStore's copy or
 * the FIRST answer of the address loader — and that loader stops at the IDB
 * cache when it holds the address. An event edited elsewhere (WP plugin,
 * another device, another client) therefore showed its old revision on its
 * own page while the calendar list showed the new one, and a deleted event
 * still rendered from a direct link, because nothing on the route loaded the
 * author's kind 5s.
 *
 * The snapshot is kept as the first paint (store first, network second). On
 * top of it the hook:
 *  - subscribes to `eventStore.replaceable(kind, pubkey, d)`, where the store
 *    keeps the NIP-01 winner (newest created_at, lowest id on a tie), so a
 *    newer revision re-renders the page the moment it lands;
 *  - asks the relays itself (`cache: false`), for the whole page lifetime —
 *    a store or IDB hit never reaches a relay otherwise, and the load's
 *    `firstValueFrom` stops listening after the first relay that answers;
 *  - loads the author's NIP-09 deletions. A kind 5 removes the event from the
 *    store (the model emits `undefined`), or keeps it out in the first place;
 *    `isDeletedEvent` (applesauce's DeleteManager) tells that apart from "not
 *    loaded yet". A revision published AFTER the deletion is shown again.
 *
 * `event` is `null` while there is nothing to show or the shown revision is
 * deleted; `deleted` is true only for the latter. Uses `$state.raw` for the
 * event (Symbol-based relay metadata must not be deep-proxied).
 *
 * MUST be called during component init (it uses $effect).
 *
 * @typedef {Object} LatestReplaceablePointer
 * @property {number} kind
 * @property {string} pubkey
 * @property {string} [identifier]
 * @property {string[]} [relays]
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader, fetchAuthorsDeletions } from '$lib/loaders/base.js';
import { isDeletedEvent } from '$lib/helpers/communityRepost.js';

/**
 * NIP-01 replaceable ordering: does `a` win over `b`?
 * @param {{ created_at: number, id: string }} a
 * @param {{ created_at: number, id: string }} b
 */
function beats(a, b) {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

/**
 * @param {() => (LatestReplaceablePointer | null | undefined)} getPointer
 * @param {() => any} getInitial - first paint (the route load's snapshot)
 * @returns {() => { event: any, deleted: boolean }}
 */
export function useLatestReplaceableEvent(getPointer, getInitial) {
  let current = $state.raw(/** @type {any} */ (null));
  let deleted = $state(false);

  $effect(() => {
    const pointer = getPointer();
    const initial = getInitial() ?? null;
    current = initial;
    deleted = isDeletedEvent(initial);

    if (!pointer || typeof pointer.kind !== 'number' || !pointer.pubkey) return;

    // Kept local so the subscription callbacks never read reactive state
    // (reading `current` there would make this effect depend on it).
    let shown = initial;

    const storeSub = eventStore
      .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
      .subscribe((e) => {
        if (e) {
          if (!shown || beats(e, shown)) {
            shown = e;
            current = e;
          }
          deleted = isDeletedEvent(shown);
        } else if (shown && isDeletedEvent(shown)) {
          // The store dropped it because of a NIP-09 deletion
          deleted = true;
        }
      });

    const loaderSub = addressLoader({ ...pointer, cache: false }).subscribe({ error: () => {} });
    const deletionsSub = fetchAuthorsDeletions([pointer.pubkey]).subscribe({ error: () => {} });

    return () => {
      storeSub.unsubscribe();
      loaderSub.unsubscribe();
      deletionsSub.unsubscribe();
    };
  });

  return () => ({ event: deleted ? null : current, deleted });
}
