/**
 * "Is this pubkey an agent, and whose?" for badges. Asks the groups relays
 * once per pubkey (`#d` = the pubkey) and keeps a Map; the owner's name is
 * resolved by the caller's profile map.
 */
import { storeEvents } from 'applesauce-relay/operators';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { TimelineModel } from 'applesauce-core/models';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { AGENT_RECORD_KIND } from './persona.js';
import { indexAgentRecords } from './agent-index.js';

/**
 * @param {() => string[]} getPubkeys
 * @returns {() => Map<string, {ownerPubkey: string, name: string}>}
 */
export function useAgentRecords(getPubkeys) {
  let records = $state.raw(/** @type {any[]} */ ([]));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- effect-local, never rendered
  const asked = new Set();

  $effect(() => {
    const pubkeys = [...new Set(getPubkeys() ?? [])].filter((p) => !asked.has(p)); // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch
    if (pubkeys.length === 0) return;
    pubkeys.forEach((p) => asked.add(p));
    const relays = [...new Set(getGroupsRelays().map(normalizeURL))]; // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    for (const relay of relays) {
      try {
        subs.push(
          pool
            .relay(relay)
            .request({ kinds: [AGENT_RECORD_KIND], '#d': pubkeys }, { timeout: 8000 })
            .pipe(storeEvents(eventStore))
            .subscribe({ error: () => {} })
        );
      } catch {
        // skip malformed relay
      }
    }
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  // Content-keyed, order-independent: reading this $derived (instead of
  // calling getPubkeys() directly inside the effect below) means the
  // TimelineModel subscription is only torn down and rebuilt when the actual
  // set of pubkeys changes — not on every unrelated EventStore update (e.g. a
  // new chat message from an already-known author) that happens to produce a
  // new getPubkeys() array with the same content.
  const recordsKey = $derived([...new Set(getPubkeys() ?? [])].sort().join('\x1f')); // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch, collapsed to a primitive string immediately

  $effect(() => {
    const pubkeys = recordsKey ? recordsKey.split('\x1f') : [];
    if (pubkeys.length === 0) {
      records = [];
      return;
    }
    const sub = eventStore
      .model(TimelineModel, { kinds: [AGENT_RECORD_KIND], '#d': pubkeys })
      .subscribe((events) => {
        records = events ?? [];
      });
    return () => sub.unsubscribe();
  });

  const map = $derived(indexAgentRecords(records));
  return () => map;
}
