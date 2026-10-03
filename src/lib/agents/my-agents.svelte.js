/**
 * The active user's agents: their kind 30177 records and 30175 personas from
 * the groups relays. Mirrors my-groups.svelte.js: request each relay
 * directly (these events live on the groups relay only), feed the store, and
 * read back through TimelineModel so deletions drop them.
 */
import { TimelineModel } from 'applesauce-core/models';
import { storeEvents } from 'applesauce-relay/operators';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { AGENT_RECORD_KIND, PERSONA_KIND } from './persona.js';
import { indexAgents } from './agent-index.js';

/** @returns {() => import('./agent-index.js').AgentEntry[]} */
export function useMyAgents() {
  const getActiveUser = useActiveUser();
  let records = $state.raw(/** @type {any[]} */ ([]));
  let personas = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    const pubkey = getActiveUser()?.pubkey;
    records = [];
    personas = [];
    if (!pubkey) return;

    const relays = [...new Set(getGroupsRelays().map(normalizeURL))]; // eslint-disable-line svelte/prefer-svelte-reactivity -- dedup scratch
    const filter = { kinds: [AGENT_RECORD_KIND, PERSONA_KIND], authors: [pubkey] };
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    for (const relay of relays) {
      try {
        subs.push(
          pool
            .relay(relay)
            .request(filter, { timeout: 8000 })
            .pipe(storeEvents(eventStore))
            .subscribe({ error: () => {} })
        );
      } catch {
        // malformed relay url — skip
      }
    }
    subs.push(
      eventStore
        .model(TimelineModel, { kinds: [AGENT_RECORD_KIND], authors: [pubkey] })
        .subscribe((events) => {
          records = events ?? [];
        })
    );
    subs.push(
      eventStore
        .model(TimelineModel, { kinds: [PERSONA_KIND], authors: [pubkey] })
        .subscribe((events) => {
          personas = events ?? [];
        })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  const agents = $derived(indexAgents(records, personas));
  return () => agents;
}
