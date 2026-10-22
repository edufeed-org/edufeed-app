/**
 * `useSchemeConcepts` must mirror the `#a` timeline, not accumulate it: when a
 * newer version of a concept (one that moved to another scheme) replaces the
 * stale one in the EventStore, the stale copy has to leave the picker list.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { EventStore } from 'applesauce-core';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

vi.mock('$lib/loaders/vocab-loader.js', () => ({
  loadConceptScheme: () => ({ unsubscribe: () => {} }),
  loadSchemeConcepts: () => ({ unsubscribe: () => {} }),
  loadAllSchemes: () => ({ unsubscribe: () => {} })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://relay.example']
}));

const sharedStore = new EventStore();
// Test fixtures have fake ids/sigs and would fail nostr-tools' verifyEvent.
sharedStore.verifyEvent = () => true;
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  get eventStore() {
    return sharedStore;
  }
}));

const { useSchemeConcepts } = await import('$lib/stores/vocab-store.svelte.js');

const PUBKEY = 'd'.repeat(64);
const METHODE = `${VOCAB_KIND}:${PUBKEY}:methode`;
const KONFI_METHODE = `${VOCAB_KIND}:${PUBKEY}:konfi-methode`;

/**
 * @param {string} id
 * @param {string} d
 * @param {string} scheme
 * @param {number} createdAt
 */
function concept(id, d, scheme, createdAt) {
  return {
    id: id.padEnd(64, '0'),
    pubkey: PUBKEY,
    kind: CONCEPT_KIND,
    created_at: createdAt,
    content: '',
    sig: 'c'.repeat(128),
    tags: [
      ['d', d],
      ['type', 'Concept'],
      ['prefLabel', 'Rollenspiel', 'de'],
      ['a', scheme, 'wss://relay.example', 'inScheme']
    ]
  };
}

/** @param {import('nostr-tools').NostrEvent} e */
const dTag = (e) => e.tags.find((t) => t[0] === 'd')?.[1];

describe('useSchemeConcepts', () => {
  it('drops a concept once a newer version moved it to another scheme', () => {
    /** @type {() => import('nostr-tools').NostrEvent[]} */
    let getter = () => [];
    const cleanup = $effect.root(() => {
      getter = useSchemeConcepts(
        () => METHODE,
        () => ['wss://relay.example']
      );
    });
    flushSync();

    sharedStore.add(concept('stale', 'rollenspiel', METHODE, 100));
    sharedStore.add(concept('new', 'methode/rollenspiel', METHODE, 150));
    flushSync();
    expect(getter().map(dTag).sort()).toEqual(['methode/rollenspiel', 'rollenspiel']);

    // The address revalidation finds the current `rollenspiel`: it now lives
    // in konfi-methode, so it must disappear from the methode list.
    sharedStore.add(concept('current', 'rollenspiel', KONFI_METHODE, 200));
    flushSync();
    expect(getter().map(dTag)).toEqual(['methode/rollenspiel']);

    cleanup();
  });
});
