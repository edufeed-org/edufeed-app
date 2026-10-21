/**
 * A concept that MOVED to another scheme must not keep showing up in its old
 * scheme just because one relay (or the IDB cache) still serves the old
 * version.
 *
 * Reproduces the "Rollenspiel doppelt" report: the vocabulary publisher split
 * the shared `methode` scheme into `methode` and `konfi-methode`. Concept
 * `rollenspiel` was re-published pointing at `konfi-methode` and a new
 * `methode/rollenspiel` was added to `methode`. relay-rpi.edufeed.org never
 * received the re-publish and still answers the `#a methode` query with the
 * 2026-05-05 version, so the picker listed "Rollenspiel" twice.
 *
 * The `#a` timeline query cannot observe that a concept left the scheme — the
 * relay that holds the newer version does not return it for the old scheme.
 * The loader therefore re-requests every concept it receives by address
 * (kind + pubkey + d); the newer version replaces the stale one in the
 * EventStore and the `#a` timeline drops it.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { from, EMPTY } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { TimelineModel } from 'applesauce-core/models';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

const PUBKEY = 'd'.repeat(64);
const METHODE = `${VOCAB_KIND}:${PUBKEY}:methode`;
const KONFI_METHODE = `${VOCAB_KIND}:${PUBKEY}:konfi-methode`;
const RELAYS = ['wss://relay.example', 'wss://stale.example'];

/**
 * @param {string} id
 * @param {string} d
 * @param {string} scheme
 * @param {number} createdAt
 */
function concept(id, d, scheme, createdAt) {
  return {
    id: id.repeat(64).slice(0, 64),
    pubkey: PUBKEY,
    kind: CONCEPT_KIND,
    created_at: createdAt,
    content: '',
    sig: 'f'.repeat(128),
    tags: [
      ['d', d],
      ['type', 'Concept'],
      ['prefLabel', 'Rollenspiel', 'de'],
      ['a', scheme, 'wss://relay.example', 'inScheme'],
      ['a', scheme, 'wss://relay.example', 'topConceptOf']
    ]
  };
}

// What the relays answer: the `#a methode` query yields the stale copy of
// `rollenspiel` (still tagged methode) next to the new `methode/rollenspiel`;
// a lookup by `#d` yields the current `rollenspiel`, which moved to
// konfi-methode.
const staleRollenspiel = concept('1', 'rollenspiel', METHODE, 100);
const currentRollenspiel = concept('2', 'rollenspiel', KONFI_METHODE, 200);
const methodeRollenspiel = concept('3', 'methode/rollenspiel', METHODE, 150);

/** @type {import('nostr-tools').Filter[][]} */
const requests = [];

// Fake events carry no real signature.
const eventStore = new EventStore({ verifyEvent: () => true });

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  get eventStore() {
    return eventStore;
  },
  pool: {
    request: (/** @type {string[]} */ _relays, /** @type {any} */ filters) => {
      const list = Array.isArray(filters) ? filters : [filters];
      requests.push(list);
      const byScheme = list.find((f) => f['#a']);
      if (byScheme) return from([staleRollenspiel, methodeRollenspiel]);
      const byAddress = list.find((f) => f['#d']);
      if (byAddress) {
        return from(
          [currentRollenspiel, methodeRollenspiel].filter((e) =>
            byAddress['#d']?.includes(e.tags[0][1])
          )
        );
      }
      return EMPTY;
    }
  }
}));

vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: async () => []
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => []
}));

const { loadSchemeConcepts } = await import('$lib/loaders/vocab-loader.js');

/** @param {import('nostr-tools').NostrEvent} e */
const dTag = (e) => e.tags.find((t) => t[0] === 'd')?.[1];

describe('loadSchemeConcepts with a relay that serves a stale concept version', () => {
  it('drops the concept that moved to another scheme instead of listing it twice', async () => {
    /** @type {import('nostr-tools').NostrEvent[]} */
    let latest = [];
    const modelSub = eventStore
      .model(TimelineModel, { kinds: [CONCEPT_KIND], '#a': [METHODE] })
      .subscribe((events) => {
        latest = events;
      });

    const sub = loadSchemeConcepts(METHODE, RELAYS);

    await vi.waitFor(
      () => {
        expect(latest.map(dTag).sort()).toEqual(['methode/rollenspiel']);
      },
      { timeout: 4000, interval: 50 }
    );

    // The stale copy was re-requested by address on the scheme's relays.
    const addressLookup = requests.flat().find((f) => f['#d']?.includes('rollenspiel'));
    expect(addressLookup).toBeDefined();
    expect(addressLookup?.kinds).toEqual([CONCEPT_KIND]);
    expect(addressLookup?.authors).toEqual([PUBKEY]);

    sub.unsubscribe();
    modelSub.unsubscribe();
  });
});
