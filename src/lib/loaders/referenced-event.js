/**
 * loadReferencedEvent — fetch the event behind a reference (a quoted note,
 * an inline naddr, a detail-page link) into the EventStore.
 *
 * Stage 1 asks the pointer's relays (the reference's hints + the lookup
 * relays, see `pointerFor`). Only when that completes without the event does
 * stage 2 ask the author's NIP-65 outboxes that stage 1 did not cover. Hints
 * are whatever relay the referencing client happened to know; the outbox
 * model is where the author says their events live. A quote whose only hint
 * was slow to connect, or dead, and that none of the lookup relays carry
 * (e.g. a note only on Primal's relays) is still found there.
 *
 * The outbox stage costs a kind 10002 lookup (cached 5 min by
 * relay-service), so it runs on a miss only, never alongside stage 1.
 * Completes when both stages are done; never errors.
 */
import { EMPTY, catchError, concat, defer, from, of, switchMap, tap } from 'rxjs';
import { normalizeURL } from 'applesauce-core/helpers';
import { eventLoader, addressLoader } from './base.js';
import { fetchRelayList } from '$lib/services/relay-service.svelte.js';

/**
 * @typedef {{ id: string, relays?: string[] }} EventRef
 * @typedef {{ kind: number, pubkey: string, identifier?: string, relays?: string[] }} AddressRef
 */

/** @param {string} url */
function normalize(url) {
  try {
    return normalizeURL(url);
  } catch {
    return url;
  }
}

/**
 * @param {EventRef | AddressRef} pointer
 * @param {{ author?: string }} [options] - Author of an event pointer (nevent
 *   `author`, q-tag pubkey). Address pointers carry their own `pubkey`.
 * @returns {import('rxjs').Observable<import('nostr-tools').NostrEvent>}
 */
export function loadReferencedEvent(pointer, { author } = {}) {
  const isAddress = !('id' in pointer);
  /** @param {any} p */
  const load = (p) => (isAddress ? addressLoader(p) : eventLoader(p));
  const owner = isAddress ? /** @type {AddressRef} */ (pointer).pubkey : author;

  let found = false;
  const first$ = load(pointer).pipe(
    tap(() => (found = true)),
    catchError(() => EMPTY)
  );

  const outbox$ = defer(() => {
    if (found || !owner) return EMPTY;
    return from(fetchRelayList(owner)).pipe(
      catchError(() => of(null)),
      switchMap((list) => {
        const asked = new Set((pointer.relays ?? []).map(normalize));
        const outboxes = [...new Set((list?.writeRelays ?? []).map(normalize))].filter(
          (relay) => !asked.has(relay)
        );
        if (outboxes.length === 0) return EMPTY;
        // The IDB cache was already asked by stage 1
        return load({ ...pointer, relays: outboxes, cache: false });
      }),
      catchError(() => EMPTY)
    );
  });

  return concat(first$, outbox$);
}
