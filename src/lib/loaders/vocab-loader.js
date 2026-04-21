import { createAddressLoader, createTimelineLoader } from 'applesauce-loaders/loaders';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { timedPool } from '$lib/loaders/base.js';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

/**
 * Parse "<kind>:<pub>:<d>" into parts.
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
 * Stream all Concept events (kind CONCEPT_KIND = 39738) that reference a given
 * scheme via their `a` tag. The scheme coord itself stays on VOCAB_KIND
 * (39737); only the queried entity kind changed in NIP-VOCAB v0.2.
 * @param {string} schemeCoord - "39737:<pub>:<d>"
 * @param {string[]} relays
 * @returns {import('rxjs').Subscription}
 */
export function loadSchemeConcepts(schemeCoord, relays) {
  const loader = createTimelineLoader(
    timedPool,
    relays,
    { kinds: [CONCEPT_KIND], '#a': [schemeCoord] },
    { eventStore, limit: 2000 }
  );
  return loader().subscribe();
}

/**
 * Stream all ConceptScheme events (kind VOCAB_KIND = 39737) on the given
 * relays. Since the NIP-VOCAB v0.2 split, each vocab entity has its own kind —
 * schemes are exclusively 39737, concepts are 39738, collections are 39739 —
 * so this filter already excludes concepts/collections at the relay level.
 * Used by the FormBuilder vocab picker to discover published schemes.
 * @param {string[]} relays
 * @returns {import('rxjs').Subscription}
 */
export function loadAllSchemes(relays) {
  const loader = createTimelineLoader(
    timedPool,
    relays,
    { kinds: [VOCAB_KIND] },
    { eventStore, limit: 500 }
  );
  return loader().subscribe();
}
