// Run a metadata plan against the relays and hand each kind:39000 back under
// the key the rail looks it up by.
//
// The pool is injected rather than imported so this can be driven by a fake in
// tests — the same shape crossref.js uses for fetch. The Svelte side passes
// (relay, filter) => pool.relay(relay).request(filter, {timeout}).
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { channelKey } from './community-pointer.js';

/**
 * @param {{
 *   requests: Array<{relay: string, filter: any}>,
 *   subscribe: (relay: string, filter: any) => {subscribe: (handlers: any) => {unsubscribe: () => void}},
 *   onMetadata: (key: string, event: any) => void,
 *   onError?: (relay: string, error: any) => void
 * }} input
 * @returns {() => void} teardown
 */
export function subscribeChannelMetadata({ requests, subscribe, onMetadata, onError }) {
  /** @type {Array<{unsubscribe: () => void}>} */
  const open = [];

  for (const request of requests) {
    const sub = subscribe(request.relay, request.filter).subscribe({
      next: (/** @type {any} */ event) => {
        if (!event || event.kind !== GROUP_METADATA_KIND || !Array.isArray(event.tags)) return;
        const id = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
        if (!id) return; // nothing to key it by
        // Key by the relay the event ARRIVED FROM, never by the id alone: two
        // relays can both carry a group called "allgemein", and keying on the
        // id would let one relay's metadata decide how the other's channel is
        // drawn — including whether it shows as open.
        const key = channelKey({ id, relay: request.relay });
        if (key) onMetadata(key, event);
      },
      // One unreachable or auth-walled relay must not blind the community to
      // its channels on every other relay.
      error: (/** @type {any} */ error) => onError?.(request.relay, error)
    });
    open.push(sub);
  }

  return () => {
    for (const sub of open) sub.unsubscribe();
  };
}
