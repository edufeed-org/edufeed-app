/**
 * useReferencedEvent — the event behind a `nostr:` reference (naddr, nevent,
 * note) rendered inline in content, store first.
 *
 * Subscribes to the EventStore by the reference's identity (id, or
 * kind/pubkey/d): the store answers at once when it already holds the event,
 * and keeps emitting — an event that arrives late (slow relay, loaded by
 * another surface) still replaces the placeholder without a remount. A
 * missing event is never an error state: `isLoading` drops after `timeoutMs`
 * so the preview can show a plain badge, and the subscription stays open.
 *
 * The network lookup is driven here, per mount, through `loadReferencedEvent`
 * (hints + lookup relays, then the author's outboxes), with a few delayed
 * retries after a miss. The store's own fallback loader is not enough: it
 * runs once per model, and models stay warm for 60 s keyed by their pointer,
 * so one miss — a hint relay still connecting while a fresh feed opens
 * dozens of sockets — was inherited by every remount (the note's detail page)
 * until a full reload.
 *
 * Replaces the previous `fetchEventById` + hard timeout in every preview,
 * which turned one sluggish relay stage into a red "not found" and discarded
 * the event when it did arrive. Call during component initialisation.
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { unique } from '$lib/helpers/unique.js';
import { loadReferencedEvent } from '$lib/loaders/referenced-event.js';

/** Delays before re-asking the network after a miss (one retry per entry). */
const RETRY_DELAYS_MS = [3000, 10000];

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
 * The author of a reference, for the outbox fallback: the nevent's `author`
 * field or the naddr's pubkey. `note` carries none.
 * @param {DecodedIdentifier} decoded
 * @returns {string | undefined}
 */
function authorFor(decoded) {
  if (!decoded?.success) return undefined;
  if (decoded.type === 'nevent') return decoded.data.author || undefined;
  if (decoded.type === 'naddr') return decoded.data.pubkey;
  return undefined;
}

/**
 * @param {() => DecodedIdentifier | null | undefined} getDecoded - Reactive
 *   decoded identifier; null/undefined (or a failed decode) loads nothing
 * @param {{ timeoutMs?: number, retryDelaysMs?: number[] }} [options]
 */
export function useReferencedEvent(
  getDecoded,
  { timeoutMs = 8000, retryDelaysMs = RETRY_DELAYS_MS } = {}
) {
  /** @type {any} $state.raw: a Nostr event */
  let event = $state.raw(null);
  let isLoading = $state(true);

  $effect(() => {
    const decoded = /** @type {DecodedIdentifier} */ (getDecoded());
    const pointer = pointerFor(decoded);
    event = null;
    if (!pointer) {
      isLoading = false;
      return;
    }
    isLoading = true;
    let found = false;
    const { relays: _relays, ...identity } = pointer;
    const sub = eventStore.event(/** @type {any} */ (identity)).subscribe((e) => {
      if (!e) return;
      found = true;
      event = e;
      isLoading = false;
    });
    const timer = setTimeout(() => {
      isLoading = false;
    }, timeoutMs);

    const author = authorFor(decoded);
    /** @type {import('rxjs').Subscription | undefined} */
    let loadSub;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let retryTimer;
    /** @param {number} attempt */
    const load = (attempt) => {
      if (found) return;
      loadSub = loadReferencedEvent(/** @type {any} */ (pointer), { author }).subscribe({
        complete: () => {
          const delay = retryDelaysMs[attempt];
          if (!found && delay !== undefined) {
            retryTimer = setTimeout(() => load(attempt + 1), delay);
          }
        }
      });
    };
    load(0);

    return () => {
      sub.unsubscribe();
      loadSub?.unsubscribe();
      clearTimeout(timer);
      clearTimeout(retryTimer);
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
