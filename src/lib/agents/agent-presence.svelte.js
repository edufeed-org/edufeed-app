/**
 * Live presence of agents: buzz-acp announces ephemeral kind 20001 with
 * content online|away|offline on its relay. One standing subscription per
 * groups relay for the pubkeys of interest; the Map holds the latest status
 * and when it arrived (presenceIsOnline applies the TTL).
 */
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { PRESENCE_KIND } from './agent-index.js';

/**
 * @param {() => string[]} getPubkeys
 * @returns {() => Map<string, {status: string, at: number}>}
 */
export function useAgentPresence(getPubkeys) {
  let presence = $state.raw(
    /** @type {Map<string, {status: string, at: number}>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- $state.raw() with a plain Map
    (new Map())
  );

  $effect(() => {
    const pubkeys = [...new Set(getPubkeys() ?? [])]; // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch
    presence = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
    if (pubkeys.length === 0) return;
    const relays = [...new Set(getGroupsRelays().map(normalizeURL))]; // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    for (const relay of relays) {
      try {
        subs.push(
          pool
            .relay(relay)
            .subscription({ kinds: [PRESENCE_KIND], authors: pubkeys })
            .subscribe({
              // pool.relay(url).subscription(...) emits the literal string
              // 'EOSE' (see call-presence.svelte.js / community-channels.svelte.js),
              // not an eventless object — the brief's `'pubkey' in event`
              // guard doesn't match that shape, so skip the marker explicitly.
              next: (/** @type {any} */ event) => {
                if (event === 'EOSE') return;
                if (!event || typeof event !== 'object' || !('pubkey' in event)) return;
                const status = String(event.content ?? '')
                  .trim()
                  .toLowerCase();
                const next = new Map(presence); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
                next.set(event.pubkey, { status, at: event.created_at });
                presence = next;
              },
              error: () => {}
            })
        );
      } catch {
        // skip malformed relay
      }
    }
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () => presence;
}
