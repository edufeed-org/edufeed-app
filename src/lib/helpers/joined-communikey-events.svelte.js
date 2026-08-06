// The kind-10222 events of every joined community, kept current.
//
// Extracted from concord/unlinked-areas.svelte.js so the NIP-29 side can ask
// the same question ("which rooms does a community I follow already show?")
// through the same machinery instead of a second copy of it. Nothing here is
// Concord-specific: a 10222 is a Communikey community event, and both the
// `concord` pointer and the `group` pointers live on it.
//
// The caller supplies its own enablement rule (`isEnabled`) — the Concord
// side gates on its feature flag, the groups side does not, and neither
// should inherit the other's gate. That parameter is the whole reason this is
// a shared helper rather than a shared constant.
import { runtimeConfig as _runtimeConfig } from '$lib/stores/config.svelte.js';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

// Module-level (not per-hook-instance): every mounted instance shares one
// fetch-once budget per pubkey per session, so re-mounting any chrome using
// this hook never re-fires the same one-shot addressLoader request — and the
// Concord and NIP-29 callers now share that budget rather than each paying
// for it. This only bounds the PROACTIVE fetch below; the reactive
// eventStore.replaceable() subscription still picks up a 10222 from ANY
// source regardless of what's in this Set.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking, not reactive state
const requestedPubkeys = new Set();

/**
 * Reactive kind-10222 events of every joined community.
 *
 * Kept current by two mechanisms: (1) a reactive `eventStore.replaceable()`
 * subscription per joined pubkey, which self-heals the instant a 10222 lands
 * from ANY source, and (2) a bounded proactive fetch — a one-shot
 * `addressLoader` load per joined pubkey (deduped per session) — so a linked
 * room doesn't sit as a duplicate unlinked row until something UNRELATED
 * happens to load that community's 10222.
 *
 * @param {() => boolean} [isEnabled] when it returns false, no subscriptions
 *   and no fetches happen and the result is empty. Read reactively, so
 *   flipping it on after mount starts the work.
 * @param {() => string[]} [getExtraPubkeys] communities to include beyond the
 *   joined set. The owner of a community does not necessarily "join" it, so
 *   without this their own community's rooms read as unclaimed and duplicate
 *   into the sidebar — measured in Chrome, not reasoned about.
 * @returns {() => any[]}
 */
export function useJoinedCommunikeyEvents(isEnabled = () => true, getExtraPubkeys = () => []) {
  const getJoinedCommunities = useJoinedCommunitiesList();

  // Reset (not reuse) on every effect re-run: joined pubkeys can
  // reorder/change length between runs, and stale entries at old indices
  // must not survive under a new, differently-shaped pubkeys array.
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  $effect(() => {
    if (!isEnabled()) {
      communikeyEvents = [];
      return;
    }

    const pubkeys = [...new Set([...getJoinedCommunities(), ...getExtraPubkeys()])];
    if (pubkeys.length === 0) {
      communikeyEvents = [];
      return;
    }

    const relays = getAllLookupRelays();

    // Effect-LOCAL accumulator (CRITICAL): each subscription callback below
    // writes into THIS plain array, then reassigns `communikeyEvents` FROM
    // it. It never reads `communikeyEvents` itself. eventStore.replaceable()
    // replays synchronously when the event is already cached, so a callback
    // reading the $state it also writes would register that state as a
    // dependency of the very effect that's writing it — a self-triggered
    // infinite re-run (`effect_update_depth_exceeded`; CLAUDE.md's "$state
    // inside $effect causes re-triggers"). See
    // concord-unlinked-areas-hook.svelte.test.js for the regression test.
    const events = new Array(pubkeys.length);
    /** @type {import('rxjs').Subscription[]} */
    const subs = pubkeys.map((pubkey, index) => {
      if (!requestedPubkeys.has(pubkey)) {
        requestedPubkeys.add(pubkey);
        // Bounded proactive fetch — CLAUDE.md "addressLoader Relay
        // Configuration": relays MUST be in the pointer, not just loader
        // config, or nothing gets queried.
        addressLoader({ kind: 10222, pubkey, relays }).subscribe();
      }
      return eventStore.replaceable(10222, pubkey).subscribe((event) => {
        events[index] = event;
        communikeyEvents = [...events];
      });
    });
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () => communikeyEvents;
}
