/**
 * Live presence of agents: buzz-acp announces ephemeral kind 20001 with
 * content online|away|offline on its relay. One standing subscription per
 * groups relay for the pubkeys of interest; the Map holds the latest status
 * and when it arrived (presenceIsOnline applies the TTL).
 */
import { untrack } from 'svelte';
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
  // Bumped every 30s so presenceIsOnline's TTL check re-evaluates even when
  // no new presence event has arrived (an entry ages from online to offline
  // purely by the clock).
  let tick = $state(0);

  // A primitive string, content-keyed and order-independent (sorted): Svelte
  // only reruns effects that read a $derived when its VALUE changes, so this
  // — unlike calling getPubkeys() directly inside the effect — does not
  // retrigger the subscription effect below just because getPubkeys()
  // returned a new array with the same pubkeys (e.g. unrelated agent fields
  // changed upstream). That would otherwise tear down and rebuild every
  // relay subscription, and wipe `presence`, on every unrelated re-render.
  const key = $derived([...new Set(getPubkeys() ?? [])].sort().join('\x1f')); // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch, collapsed to a primitive string immediately

  $effect(() => {
    const pubkeys = key ? key.split('\x1f') : [];
    const set = new Set(pubkeys); // eslint-disable-line svelte/prefer-svelte-reactivity -- scratch
    // Keep whatever we already know about pubkeys still of interest instead
    // of wiping everything — only entries for pubkeys that dropped out of
    // the set are discarded. Read `presence` UNTRACKED: this effect writes it
    // right after, and a tracked read would make that write re-run the effect
    // (effect_update_depth_exceeded).
    const known = untrack(() => presence);
    presence = new Map([...known].filter(([pk]) => set.has(pk))); // eslint-disable-line svelte/prefer-svelte-reactivity -- replaced wholesale
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

  $effect(() => {
    const interval = setInterval(() => {
      tick++;
    }, 30_000);
    return () => clearInterval(interval);
  });

  return () => {
    void tick;
    return presence;
  };
}
