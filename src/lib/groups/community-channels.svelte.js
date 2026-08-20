// Reactive channel DISCOVERY for a moderated community — read THROUGH the
// eventStore from the relay subtree, NOT from the kind-10222 `group` pointer.
//
// A community is one root NIP-29 group plus the channel subgroups that carry
// ["parent", rootId]. The pyramid fork serves that subtree as a per-community
// virtual endpoint (wss://host/c/<rootId>, groups/virtual.go): a bare
// {kinds:[39000]} REQ there returns the root + its children (private children
// only to authenticated members). So we ask the endpoint ONCE for all 39000s,
// feed them into the eventStore (storeEvents), and DERIVE the channel list from
// the store (buildSubtreeChannels) — the same eventStore treatment the rosters
// (channel-rosters.svelte.js) and kind-9 chat (GroupChat.svelte) already get.
//
// Why this replaces parseGroupPointers(kind-10222): appending a `group` pointer
// is an owner-signed 10222 edit, so only the community key-holder could add a
// channel. Discovering from the subtree drops that pointer entirely — any root
// 39001 admin creates a channel (9007 + 9002 parent, signed with their OWN key;
// the relay enforces admin-of-parent), and it shows up here with no 10222 edit.
//
// Shape mirrors useChannelRosters: value-stable key + 300ms debounce (a caller
// rebuilding the same root pointer on every unrelated re-render must not reopen
// the subscription), proactive NIP-42 auth (the endpoint hides private children
// from anonymous readers), a `fetched` flag that never fabricates an empty list,
// and a bounded cold-start retry for the fetch that ends before the relay
// connection is warm. State is $state.raw: the values are external nostr events
// whose memoising helpers must not be trapped in a deep reactive proxy (061c05c9).
import { GROUP_METADATA_KIND } from 'applesauce-common/helpers/groups';
import { TimelineModel } from 'applesauce-core/models';
import { storeEvents } from 'applesauce-relay/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { authenticateOnce } from './relay-auth.js';
import { communityGroupsEndpoint, flatGroupsRelay } from './community-endpoint.js';
import { buildSubtreeChannels } from './subtree-channels.js';

// Same cold-start reasoning as channel-rosters: a first fetch can END
// (EOSE/timeout) before the relay connection is ready and the 39000s arrive —
// a fresh reload would then show no channels until some other surface re-asks.
const MAX_DISCOVERY_RETRIES = 4;

const SEP = '\x1f';

/**
 * @param {() => ({id: string, relay: string} | null | undefined)} getRootPointer
 *   the community's ["membership", rootId, relay] pointer (parseMembershipPointer)
 * @returns {() => {
 *   channels: import('./subtree-channels.js').SubtreeChannel[],
 *   rootChannel: import('./subtree-channels.js').SubtreeChannel | null,
 *   fetched: boolean,
 *   refresh: () => void
 * }}
 */
export function useCommunityChannels(getRootPointer) {
  /** @type {import('./subtree-channels.js').SubtreeChannel[]} */
  let channels = $state.raw([]);
  /** @type {import('./subtree-channels.js').SubtreeChannel | null} */
  let rootChannel = $state.raw(null);
  // The endpoint fetch has ENDED (EOSE or timeout/error). Distinguishes "the
  // relay said nothing → no channels" from "still loading", WITHOUT writing an
  // empty channel list that could flicker over the stored one.
  let fetched = $state(false);
  // Bumped to re-run the FETCH effect (refresh, auth success, cold-start retry)
  // without the root pointer having changed. Read FIRST in the effect so it
  // registers as a dependency (svelte-effect-early-return-dead lesson).
  let seq = $state(0);

  let retryCount = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer;

  const getActiveUser = useActiveUser();

  // rootId + endpoint, as ONE value-stable string. Empty when there is no root
  // (open community) — the caller then shows no channel discovery at all.
  const discoveryKey = $derived.by(() => {
    const p = getRootPointer();
    if (!p?.id || !p?.relay) return '';
    return `${p.id}${SEP}${communityGroupsEndpoint(flatGroupsRelay(p.relay), p.id)}`;
  });

  let previousKey = '';

  // ── Proactive NIP-42 auth: the /c endpoint reveals private children only to
  //    authenticated members. Authenticate up front so the first read already
  //    runs authenticated; a success re-runs the fetch (seq). ──
  $effect(() => {
    const key = discoveryKey;
    const user = getActiveUser();
    if (key === '' || !user?.signer) return;
    const endpoint = key.split(SEP)[1];
    let cancelled = false;
    authenticateOnce(pool.relay(endpoint), user.signer).then((response) => {
      if (!cancelled && response.ok) seq++;
    });
    return () => {
      cancelled = true;
    };
  });

  // ── Fetch: feed every 39000 the endpoint serves into the eventStore, then
  //    mark fetched when it stops speaking. ──
  $effect(() => {
    void seq;
    const key = discoveryKey;
    const keyChanged = key !== previousKey;
    previousKey = key;
    if (keyChanged) {
      fetched = false;
      retryCount = 0;
    }
    if (key === '') return;
    const [rootId, endpoint] = key.split(SEP);

    /** @type {Array<{unsubscribe: () => void}>} */
    const open = [];
    const timer = setTimeout(() => {
      const markFetched = () => {
        fetched = true;
        // Cold-start guard: a community ALWAYS has at least its root 39000, so
        // "fetched but the store has no root 39000" almost always means the
        // read raced the relay connection — retry (bounded, backing off).
        const missing =
          eventStore.getByFilters({ kinds: [GROUP_METADATA_KIND], '#d': [rootId] }).length === 0;
        if (missing && retryCount < MAX_DISCOVERY_RETRIES) {
          retryCount++;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => seq++, 400 * retryCount);
        }
      };
      try {
        const sub = pool
          .relay(endpoint)
          .request({ kinds: [GROUP_METADATA_KIND] }, { timeout: 8000 })
          .pipe(storeEvents(eventStore))
          .subscribe({ complete: markFetched, error: markFetched });
        open.push(sub);
      } catch (err) {
        console.warn('[community-channels] failed to request subtree from', endpoint, err);
        markFetched();
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      for (const sub of open) sub.unsubscribe();
    };
  });

  // ── Read: derive the channel list reactively from the eventStore. Emits
  //    synchronously on subscribe with whatever the store already holds, so a
  //    remount is populated instantly (no reliance on relay replay). ──
  $effect(() => {
    const key = discoveryKey;
    if (key === '') {
      channels = [];
      rootChannel = null;
      return;
    }
    const [rootId, endpoint] = key.split(SEP);

    const sub = eventStore
      .model(TimelineModel, { kinds: [GROUP_METADATA_KIND] })
      .subscribe((/** @type {any[]} */ events) => {
        const { root, channels: derived } = buildSubtreeChannels(events, rootId, endpoint);
        channels = derived;
        rootChannel = root;
      });

    return () => sub.unsubscribe();
  });

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let healTimer;
  $effect(() => {
    return () => {
      clearTimeout(healTimer);
      clearTimeout(retryTimer);
    };
  });

  /**
   * Re-fetch the subtree: immediately, then once more ~800ms later. A relay's
   * OK for the 9007/9002 that creates a channel does not guarantee the 39000 it
   * materialises is queryable by the time an immediate re-request lands, so a
   * just-created channel would otherwise not appear until the next navigation.
   * The store's newest-wins means the second fetch simply supersedes. Same
   * shape as useChannelRosters.refresh / GroupChat's onRosterChanged.
   */
  function refresh() {
    seq++;
    clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      seq++;
    }, 800);
  }

  return () => ({ channels, rootChannel, fetched, refresh });
}
