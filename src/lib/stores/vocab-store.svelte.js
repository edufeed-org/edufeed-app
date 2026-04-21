import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel, ReplaceableModel } from 'applesauce-core/models';
import {
  loadConceptScheme,
  loadSchemeConcepts,
  loadAllSchemes
} from '$lib/loaders/vocab-loader.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { VOCAB_KIND, CONCEPT_KIND } from 'nostr-vocab-core/constants';

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
      .model(TimelineModel, { kinds: [CONCEPT_KIND], '#a': [coord] })
      .subscribe((events) => {
        let changed = false;
        for (const e of events || []) {
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

/**
 * Reactive hook: returns all ConceptScheme events (kind VOCAB_KIND = 39737)
 * discovered on the given relays. Used by the FormBuilder vocab picker.
 *
 * Since NIP-VOCAB v0.2, kind 39737 is exclusive to ConceptSchemes — concepts
 * live on 39738 and collections on 39739 — so no type-tag filter is needed.
 * A pre-split legacy guard keeps any residual `type: Concept` events that
 * happen to still be published on kind 39737 out of the scheme list.
 *
 * @param {() => string[]} getRelays
 * @returns {() => import('nostr-tools').NostrEvent[]}
 */
export function useConceptSchemes(getRelays) {
  /** @type {import('nostr-tools').NostrEvent[]} */
  let schemes = $state.raw([]);

  $effect(() => {
    const relays = getRelays();
    if (!relays || relays.length === 0) {
      schemes = [];
      return;
    }

    const loaderSub = loadAllSchemes(relays);
    const modelSub = eventStore
      .model(TimelineModel, { kinds: [VOCAB_KIND] })
      .subscribe((events) => {
        // Legacy guard: reject pre-split events that are concepts/collections
        // accidentally stored on kind 39737. Post-split relays never see them.
        const onlySchemes = (events || []).filter((e) => {
          const typeTag = e.tags.find((t) => t[0] === 'type')?.[1];
          return !typeTag || typeTag === 'ConceptScheme';
        });
        schemes = onlySchemes;
      });

    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  return () => schemes;
}
