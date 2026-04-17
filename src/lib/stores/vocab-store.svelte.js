import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel, ReplaceableModel } from 'applesauce-core/models';
import { loadConceptScheme, loadSchemeConcepts } from '$lib/loaders/vocab-loader.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Reactive hook: returns the kind-39737 ConceptScheme event for a given address.
 * @param {() => { address: string, relay: string } | undefined} getAddr
 * @returns {() => import('nostr-tools').NostrEvent | undefined}
 */
export function useConceptScheme(getAddr) {
  /** @type {import('nostr-tools').NostrEvent | undefined} */
  let event = $state(undefined);

  $effect(() => {
    const ref = getAddr();
    if (!ref?.address) {
      event = undefined;
      return;
    }
    const [kind, pubkey, d] = ref.address.split(':');
    const loaderSub = loadConceptScheme(ref, getAllLookupRelays());
    const modelSub = eventStore
      .model(ReplaceableModel, { kind: Number(kind), pubkey, identifier: d })
      .subscribe((e) => {
        event = e;
      });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  return () => event;
}

/**
 * Reactive hook: returns the Concept events belonging to a scheme.
 * @param {() => string | undefined} getSchemeCoord - "39737:<pub>:<d>"
 * @param {() => string[]} getRelays
 * @returns {() => import('nostr-tools').NostrEvent[]}
 */
export function useSchemeConcepts(getSchemeCoord, getRelays) {
  /** @type {import('nostr-tools').NostrEvent[]} */
  let concepts = $state.raw([]);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal dedup tracker, not reactive
  const loadedIds = new Map();

  $effect(() => {
    const coord = getSchemeCoord();
    if (!coord) {
      concepts = [];
      return;
    }
    loadedIds.clear();

    const relays = getRelays();
    const loaderSub = loadSchemeConcepts(coord, relays);
    const modelSub = eventStore
      .model(TimelineModel, { kinds: [39737], '#a': [coord] })
      .subscribe((events) => {
        let changed = false;
        for (const e of events || []) {
          // Only keep events that are Concepts (not Collections, not the scheme itself)
          const isConcept = e.tags.some((t) => t[0] === 'type' && t[1] === 'Concept');
          if (!isConcept) continue;
          if (!loadedIds.has(e.id)) {
            loadedIds.set(e.id, e);
            changed = true;
          }
        }
        if (changed) concepts = Array.from(loadedIds.values());
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  return () => concepts;
}
