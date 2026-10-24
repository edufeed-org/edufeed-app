import { createAddressLoader } from 'applesauce-loaders/loaders';
import { getReplaceableIdentifier } from 'applesauce-core/helpers';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader, fetchEvents } from '$lib/loaders/base.js';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

/** Concept addresses already re-requested by `d` this session. */
const revalidatedConcepts = new Set();

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
 *
 * Concepts are addressable, and a `#a` query cannot observe that a concept
 * LEFT the scheme: a relay (or the IDB cache) that still holds the version
 * tagged with this scheme keeps answering with it, while the relay that has
 * the newer version — now tagged with another scheme — does not return it for
 * this query. Every concept received is therefore re-requested once per
 * session by address (`cache: false` skips the cache step); a newer version
 * replaces the stale one in the EventStore and the `#a` timeline drops it.
 * The vocabulary split of `methode` into `methode` + `konfi-methode` left
 * exactly such a stale `rollenspiel` on one relay, which listed "Rollenspiel"
 * twice in the EKW method picker.
 * @param {string} schemeCoord - "39737:<pub>:<d>"
 * @param {string[]} relays
 * @returns {import('rxjs').Subscription}
 */
export function loadSchemeConcepts(schemeCoord, relays) {
  return fetchEvents(
    relays,
    { kinds: [CONCEPT_KIND], '#a': [schemeCoord], limit: 2000 },
    { cache: true }
  ).subscribe({
    next: (/** @type {import('nostr-tools').Event} */ event) => {
      const identifier = getReplaceableIdentifier(event);
      const address = `${event.kind}:${event.pubkey}:${identifier}`;
      if (revalidatedConcepts.has(address)) return;
      revalidatedConcepts.add(address);
      addressLoader({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier,
        relays,
        cache: false
      }).subscribe({ error: () => {} });
    },
    error: () => {}
  });
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
  return fetchEvents(relays, { kinds: [VOCAB_KIND], limit: 500 }, { cache: true }).subscribe();
}
