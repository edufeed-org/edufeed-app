/**
 * Personal lists singleton store.
 *
 * Tracks the active user's NIP-51 list events across every kind enumerated
 * in `$lib/helpers/list-kinds.js`. A single loader + a single TimelineModel
 * subscription covers all kinds; per-kind readers are exposed as reactive
 * hooks.
 *
 * Usage:
 *   import { useList, useAllLists, isListsLoading } from '$lib/stores/personal-lists.svelte.js';
 *   const getList = useList(kinds.Mutelist);           // singleton
 *   const getSets = useAllLists(kinds.Followsets);     // addressable → reactive array
 */
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { getWriteRelays } from '$lib/services/relay-service.svelte.js';
import {
  LIST_KINDS,
  STANDARD_LIST_KINDS,
  PARAMETERIZED_LIST_KINDS
} from '$lib/helpers/list-kinds.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Singleton (replaceable) lists indexed by kind. */
/** @type {Record<number, import('nostr-tools').NostrEvent | null>} */
let singletons = $state({});

/** Addressable (parameterized) list events — flat array across all kinds. */
/** @type {import('nostr-tools').NostrEvent[]} */
let sets = $state.raw([]);

let _loading = $state(false);

// ---------------------------------------------------------------------------
// Lifecycle — subscribe to active user, load every list kind
// ---------------------------------------------------------------------------

$effect.root(() => {
  /** @type {import('rxjs').Subscription[]} */
  let subs = [];

  $effect(() => {
    const mgrSub = manager.active$.subscribe((user) => {
      // tear down previous subscriptions
      for (const s of subs) s.unsubscribe();
      subs = [];
      singletons = {};
      sets = [];

      if (!user?.pubkey) {
        _loading = false;
        return;
      }

      _loading = true;
      const pubkey = user.pubkey;

      // Per-kind singleton subscriptions (sync, EventStore only)
      for (const kind of STANDARD_LIST_KINDS) {
        subs.push(
          eventStore.replaceable(kind, pubkey).subscribe((event) => {
            singletons = { ...singletons, [kind]: event ?? null };
          })
        );
      }

      // Addressable sets — a single TimelineModel covers all parameterized kinds
      subs.push(
        eventStore
          .model(TimelineModel, { kinds: PARAMETERIZED_LIST_KINDS, authors: [pubkey] })
          .subscribe((events) => {
            sets = events ?? [];
            _loading = false;
          })
      );

      // Network fetch — user's write relays, all list kinds at once
      getWriteRelays(pubkey).then((relays) => {
        if (!relays?.length) {
          _loading = false;
          return;
        }
        const allKinds = Object.keys(LIST_KINDS).map(Number);
        const loader = createTimelineLoader(
          timedPool,
          relays,
          { kinds: allKinds, authors: [pubkey], limit: 100 },
          { eventStore }
        );
        subs.push(loader().subscribe({ complete: () => (_loading = false) }));
      });
    });

    return () => {
      mgrSub.unsubscribe();
      for (const s of subs) s.unsubscribe();
    };
  });
});

// ---------------------------------------------------------------------------
// Reader hooks
// ---------------------------------------------------------------------------

/**
 * Reactive getter for a singleton list. Returns `null` when the user has no
 * event of that kind yet.
 *
 * @param {number} kind
 * @returns {() => import('nostr-tools').NostrEvent | null}
 */
export function useList(kind) {
  return () => singletons[kind] ?? null;
}

/**
 * Reactive getter for an addressable list by d-tag.
 *
 * @param {number} kind
 * @param {string} dTag
 * @returns {() => import('nostr-tools').NostrEvent | null}
 */
export function useSet(kind, dTag) {
  return () => {
    const match = sets.find((e) => {
      if (e.kind !== kind) return false;
      const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
      return d === dTag;
    });
    return match ?? null;
  };
}

/**
 * Reactive getter for every addressable list of the given kind.
 *
 * @param {number} kind
 * @returns {() => import('nostr-tools').NostrEvent[]}
 */
export function useAllLists(kind) {
  return () => sets.filter((e) => e.kind === kind);
}

/** Whether the initial network fetch is still in flight. */
export function isListsLoading() {
  return _loading;
}

/** All singletons indexed by kind (reactive). */
export function getAllSingletons() {
  return singletons;
}

/** All addressable list events (reactive). */
export function getAllSets() {
  return sets;
}
