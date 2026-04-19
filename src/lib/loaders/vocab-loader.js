import { createAddressLoader, createTimelineLoader } from 'applesauce-loaders/loaders';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool } from '$lib/loaders/base.js';

const VOCAB_KIND = 39737;

/**
 * Parse "39737:<pub>:<d>" into parts.
 * @param {string} address
 */
function parseVocabAddress(address) {
  const [kind, pubkey, d] = address.split(':');
  return { kind: Number(kind), pubkey, d };
}

/**
 * Fetch a ConceptScheme (or any single addressable vocab event) by its coordinate.
 * @param {{ address: string, relay: string }} ref
 * @param {string[]} [extraRelays]
 * @returns {import('rxjs').Subscription}
 */
export function loadConceptScheme(ref, extraRelays = []) {
  const { kind, pubkey, d } = parseVocabAddress(ref.address);
  const relays = [ref.relay, ...extraRelays].filter(Boolean);
  const loader = createAddressLoader(pool, {
    eventStore,
    lookupRelays: relays
  });
  return loader({ kind, pubkey, identifier: d, relays }).subscribe();
}

/**
 * Stream all Concept events that reference a given scheme via its a-tag.
 * Uses the vocab relays (addr's relay hint + any extras) and #a filter.
 * @param {string} schemeCoord - "39737:<pub>:<d>"
 * @param {string[]} relays
 * @returns {import('rxjs').Subscription}
 */
export function loadSchemeConcepts(schemeCoord, relays) {
  const loader = createTimelineLoader(
    timedPool,
    relays,
    { kinds: [VOCAB_KIND], '#a': [schemeCoord] },
    { eventStore, limit: 2000 }
  );
  return loader().subscribe();
}
