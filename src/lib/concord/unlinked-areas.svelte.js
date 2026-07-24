// Reactive hook wrapping the pure unlinkedConcordAreas/linkedConcordIds
// helpers (unlinked-areas.js) for nav/sidebar components. Imports concord
// submodules directly (client.svelte.js has no top-level package imports) —
// the convention every Concord call site follows (see CLAUDE.md's Concord
// section) — so components stay SSR-clean.
import { getConcordState } from './client.svelte.js';
import { unlinkedConcordAreas, linkedConcordIds } from './unlinked-areas.js';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Concord memberships NOT linked to any followed Communikey community —
 * i.e. private areas only reachable at `/private/<communityId>`, not
 * through a community page's channels tab. Best-effort (see
 * unlinked-areas.js doc comment): "linked" is derived only from kind 10222
 * events already resident in the EventStore (no new per-pubkey network
 * fetch is spawned here — this hook is meant for chrome that renders on
 * every route).
 * @returns {() => Array<{communityId: string, name: string, dissolved: boolean}>}
 */
export function useUnlinkedConcordAreas() {
  const getJoinedCommunities = useJoinedCommunitiesList();

  // Reset (not reuse) on every effect re-run: joined pubkeys can
  // reorder/change length between runs, and stale entries at old indices
  // must not survive under a new, differently-shaped pubkeys array.
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  $effect(() => {
    const pubkeys = getJoinedCommunities();
    communikeyEvents = new Array(pubkeys.length);
    if (pubkeys.length === 0) return;
    /** @type {import('rxjs').Subscription[]} */
    const subs = pubkeys.map((pubkey, index) =>
      eventStore.replaceable(10222, pubkey).subscribe((event) => {
        const next = [...communikeyEvents];
        next[index] = event;
        communikeyEvents = next;
      })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () =>
    unlinkedConcordAreas({
      communities: getConcordState().communities,
      linkedIds: linkedConcordIds(communikeyEvents)
    });
}
