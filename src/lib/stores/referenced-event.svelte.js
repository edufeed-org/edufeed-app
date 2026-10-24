/**
 * useReferencedEvent — the event behind a `nostr:` reference (naddr, nevent,
 * note) rendered inline in content, store first.
 *
 * Subscribes to `eventStore.event(pointer)`: the store answers at once when
 * it already holds the event, otherwise its attached unified loader asks the
 * pointer's relay hints and the lookup relays, and the subscription keeps
 * emitting — an event that arrives late (slow relay, loaded by another
 * surface) still replaces the placeholder without a remount. A missing event
 * is never an error state: `isLoading` drops after `timeoutMs` so the preview
 * can show a plain badge, and the subscription stays open for a late answer.
 *
 * Replaces the previous `fetchEventById` + hard timeout in every preview,
 * which turned one sluggish relay stage into a red "not found" and discarded
 * the event when it did arrive. Call during component initialisation.
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';

/**
 * @typedef {import('$lib/helpers/nostrUtils.js').decodeNostrIdentifier} Decode
 * @typedef {ReturnType<Decode>} DecodedIdentifier
 */

/**
 * Store pointer for a decoded identifier: relay hints first, then the lookup relays.
 * @param {DecodedIdentifier} decoded
 * @returns {Record<string, any> | null}
 */
export function pointerFor(decoded) {
  if (!decoded?.success) return null;
  const hints = /** @type {string[]} */ (decoded.data?.relays?.length ? decoded.data.relays : []);
  const relays = unique([...hints, ...getAllLookupRelays()]);
  switch (decoded.type) {
    case 'naddr':
      return {
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays
      };
    case 'nevent':
      return { id: decoded.data.id, relays };
    case 'note':
      return { id: decoded.data, relays };
    default:
      return null;
  }
}

/**
 * @param {() => DecodedIdentifier} getDecoded - Reactive decoded identifier
 * @param {{ timeoutMs?: number }} [options]
 */
export function useReferencedEvent(getDecoded, { timeoutMs = 8000 } = {}) {
  /** @type {any} $state.raw: a Nostr event */
  let event = $state.raw(null);
  let isLoading = $state(true);

  $effect(() => {
    const pointer = pointerFor(getDecoded());
    event = null;
    if (!pointer) {
      isLoading = false;
      return;
    }
    isLoading = true;
    const sub = eventStore.event(/** @type {any} */ (pointer)).subscribe((e) => {
      if (!e) return;
      event = e;
      isLoading = false;
    });
    const timer = setTimeout(() => {
      isLoading = false;
    }, timeoutMs);
    return () => {
      sub.unsubscribe();
      clearTimeout(timer);
    };
  });

  return {
    get event() {
      return event;
    },
    /** True until the event arrived or `timeoutMs` passed; never an error. */
    get isLoading() {
      return isLoading;
    }
  };
}
