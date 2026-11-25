// Reactive resolution of a kind-9000 "added you" notification: which community
// (kind 10222 whose membership pointer names the group, or the group's
// `parent` for a channel) or, failing that, which group host, plus the
// group's own name from its kind 39000.
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { TimelineModel } from 'applesauce-core/models';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { groupIdOf, resolveGroupAdded, resolveChannelMention } from './group-added.js';

/**
 * What the resolvers need from the store for one group: the known kind
 * 10222s, the group's kind 39000 and the communities the user joined (kind
 * 30000 `communities`, which the app shell keeps loaded — read here, not
 * through useJoinedCommunitiesList, which would ask the relays once per
 * inbox row).
 * @param {() => string | null} getGroupId
 */
function useGroupLookup(getGroupId) {
  const getUser = useActiveUser();
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  let metadataEvent = $state.raw(/** @type {any} */ (null));
  let joinedPubkeys = $state.raw(/** @type {string[]} */ ([]));

  $effect(() => {
    const groupId = getGroupId();
    communikeyEvents = [];
    metadataEvent = null;
    joinedPubkeys = [];
    if (!groupId) return;
    const communitySub = eventStore.model(TimelineModel, { kinds: [10222] }).subscribe((events) => {
      communikeyEvents = events ?? [];
    });
    const metaSub = eventStore
      .model(TimelineModel, { kinds: [39000], '#d': [groupId] })
      .subscribe((events) => {
        metadataEvent = events?.[0] ?? null;
      });
    const me = getUser()?.pubkey;
    const joinedSub = me
      ? eventStore.replaceable(30000, me, 'communities').subscribe((list) => {
          joinedPubkeys = list ? getProfilePointersFromList(list).map((p) => p.pubkey) : [];
        })
      : undefined;
    return () => {
      communitySub.unsubscribe();
      metaSub.unsubscribe();
      joinedSub?.unsubscribe();
    };
  });

  return () => ({ communikeyEvents, metadataEvent, joinedPubkeys });
}

/**
 * Call during component init.
 * @param {() => any} getEvent the kind-9000 event
 * @returns {() => ReturnType<typeof resolveGroupAdded>}
 */
export function useGroupAddedTarget(getEvent) {
  const lookup = useGroupLookup(() => groupIdOf(getEvent()));
  return () =>
    resolveGroupAdded({
      groupId: groupIdOf(getEvent()),
      // The put-user carries no host; the deployment's groups relay is where
      // the inbox fetched it from.
      relay: getGroupsRelays()[0] ?? null,
      ...lookup()
    });
}

/**
 * Reactive target of a kind-9 channel mention/reply notification: the message
 * in its channel on the groups host, named after the channel's kind 39000
 * (which the inbox prefetches, see prefetchGroupMetadata).
 * Call during component init.
 * @param {() => any} getEvent the kind-9 event, or null for anything else
 * @returns {() => { href: string | null, groupName: string | null }}
 */
export function useChannelMentionTarget(getEvent) {
  const lookup = useGroupLookup(() => groupIdOf(getEvent()));
  return () => {
    const event = getEvent();
    return resolveChannelMention({
      groupId: groupIdOf(event),
      // Same assumption as the put-user above: the deployment's groups relay
      // is where the inbox fetched the message from.
      relay: getGroupsRelays()[0] ?? null,
      messageId: event?.id ?? '',
      ...lookup()
    });
  };
}
