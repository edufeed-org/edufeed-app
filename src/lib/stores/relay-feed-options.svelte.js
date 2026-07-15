/**
 * useRelayFeedOptions — reactive relay list for the dashboard feed selector.
 * Sources are deployment-gated via runtimeConfig.feed.relaySources
 * (FEED_RELAY_SOURCES env; default `config,custom`):
 * - config: deployment-curated relays (FEED_RELAYS env)
 * - custom: user-added free-text relays (persisted in app settings)
 * - nip65: the user's kind 10002 relay list (read ∪ write, NO default-relay fallback)
 * - community: joined communities' relays (kind 10222)
 * Returns a getter for RelayOption[].
 */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { getAllCommunityRelays } from '$lib/helpers/communityRelays.js';
import { getCommunikeyRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { addressLoader } from '$lib/loaders/base.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { buildRelayOptions, resolveFeedRelaySources } from '$lib/helpers/relay-feed.js';

/**
 * @returns {() => import('$lib/helpers/relay-feed.js').RelayOption[]}
 */
export function useRelayFeedOptions() {
  const getActiveUser = useActiveUser();
  const getJoinedCommunities = useJoinedCommunitiesList();

  let nip65Relays = $state.raw(/** @type {string[]} */ ([]));
  let communityRelays = $state.raw(/** @type {string[]} */ ([]));

  // User's kind 10002 relay list. Raw r-tags (read ∪ write; no marker = both) —
  // deliberately NOT getReadRelays(), which falls back to app default relays.
  $effect(() => {
    // Read all reactive deps before any early return (dead-effect gotcha)
    const enabled = resolveFeedRelaySources(runtimeConfig.feed).has('nip65');
    const pubkey = getActiveUser()?.pubkey;
    if (!enabled || !pubkey) {
      nip65Relays = [];
      return;
    }
    const loaderSub = addressLoader({
      kind: 10002,
      pubkey,
      relays: getAllLookupRelays()
    }).subscribe();
    const sub = eventStore.replaceable(10002, pubkey).subscribe((event) => {
      nip65Relays = event ? event.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]) : [];
    });
    return () => {
      sub.unsubscribe();
      loaderSub.unsubscribe();
    };
  });

  // Joined communities' relays from their kind 10222 events.
  $effect(() => {
    const enabled = resolveFeedRelaySources(runtimeConfig.feed).has('community');
    const joined = getJoinedCommunities();
    if (!enabled || joined.length === 0) {
      communityRelays = [];
      return;
    }
    const cleanups = joined.map((pubkey) => {
      const addrSub = addressLoader({
        kind: 10222,
        pubkey,
        relays: getCommunikeyRelays()
      }).subscribe();
      const sub = eventStore.replaceable(10222, pubkey).subscribe(() => {
        // Recompute from every cached community event so late arrivals merge in
        const relays = [];
        for (const pk of joined) {
          const communityEvent = eventStore.getReplaceable(10222, pk);
          if (communityEvent) relays.push(...getAllCommunityRelays(communityEvent));
        }
        communityRelays = relays;
      });
      return () => {
        addrSub.unsubscribe();
        sub.unsubscribe();
      };
    });
    return () => cleanups.forEach((fn) => fn());
  });

  return () => {
    const sources = resolveFeedRelaySources(runtimeConfig.feed);
    return buildRelayOptions(
      [
        ...(sources.has('config') ? (runtimeConfig.feed?.relays ?? []) : []),
        ...(sources.has('nip65') ? nip65Relays : [])
      ],
      sources.has('community') ? communityRelays : [],
      sources.has('custom') ? appSettings.dashboardCustomRelays : []
    );
  };
}
