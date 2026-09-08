// Reactive resolution of a kind-9000 "added you" notification: which community
// (kind 10222 whose membership pointer names the group) or, failing that,
// which group host, plus the group's own name from its kind 39000.
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { groupIdOf, resolveGroupAdded } from './group-added.js';

/**
 * Call during component init.
 * @param {() => any} getEvent the kind-9000 event
 * @returns {() => { communityPubkey: string | null, href: string | null, groupName: string | null }}
 */
export function useGroupAddedTarget(getEvent) {
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  let metadataEvent = $state.raw(/** @type {any} */ (null));

  $effect(() => {
    const groupId = groupIdOf(getEvent());
    communikeyEvents = [];
    metadataEvent = null;
    if (!groupId) return;
    const communitySub = eventStore.model(TimelineModel, { kinds: [10222] }).subscribe((events) => {
      communikeyEvents = events ?? [];
    });
    const metaSub = eventStore
      .model(TimelineModel, { kinds: [39000], '#d': [groupId] })
      .subscribe((events) => {
        metadataEvent = events?.[0] ?? null;
      });
    return () => {
      communitySub.unsubscribe();
      metaSub.unsubscribe();
    };
  });

  return () =>
    resolveGroupAdded({
      groupId: groupIdOf(getEvent()),
      // The put-user carries no host; the deployment's groups relay is where
      // the inbox fetched it from.
      relay: getGroupsRelays()[0] ?? null,
      communikeyEvents,
      metadataEvent
    });
}
