// Reactive side of channel-mentions.js: the "@" pill on the rail's community
// icon and on a community's channel rows, and the rule that opening a channel
// marks its mention rows in the inbox read.
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import {
  getNotifications,
  isNotificationUnread,
  getInboxPubkey,
  markItemsAsRead
} from '$lib/services/inbox-service.svelte.js';
import { unreadMentionsByGroup, communityHasMention } from './channel-mentions.js';

/** Channel id → unread mention/reply ids. Recomputed per read; the list is small. */
export function getUnreadMentionsByGroup() {
  return unreadMentionsByGroup(getNotifications(), isNotificationUnread, getInboxPubkey());
}

/** @param {string | null | undefined} groupId */
export function hasUnreadChannelMention(groupId) {
  return Boolean(groupId) && getUnreadMentionsByGroup().has(/** @type {string} */ (groupId));
}

/**
 * Whether one of a community's channels holds an unread mention of you.
 * The community's kind 10222 comes from the store; it is fetched only while
 * there is an unread channel mention at all, so a quiet rail costs nothing.
 * Call during component init.
 * @param {() => string | null | undefined} getPubkey community pubkey
 * @returns {() => boolean}
 */
export function useCommunityMention(getPubkey) {
  let community = $state.raw(/** @type {any} */ (null));
  let groupMetadata = $state.raw(/** @type {any[]} */ ([]));
  const mentionedIds = $derived([...getUnreadMentionsByGroup().keys()].sort());
  const anyMention = $derived(mentionedIds.length > 0);

  // The mentioned channels' kind 39000s (their `parent` names the community
  // root) — already in the store: the inbox prefetches them for its rows.
  $effect(() => {
    const ids = mentionedIds;
    groupMetadata = [];
    if (!ids.length) return;
    const sub = eventStore
      .model(TimelineModel, { kinds: [39000], '#d': ids })
      .subscribe((events) => {
        groupMetadata = events ?? [];
      });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const pubkey = getPubkey();
    community = null;
    if (!pubkey) return;
    const sub = eventStore
      .model(TimelineModel, { kinds: [10222], authors: [pubkey] })
      .subscribe((events) => {
        community = events?.[0] ?? null;
      });
    return () => sub.unsubscribe();
  });

  $effect(() => {
    const pubkey = getPubkey();
    if (!pubkey || !anyMention || community) return;
    const sub = addressLoader({ kind: 10222, pubkey, relays: getCommunikeyRelays() }).subscribe();
    return () => sub.unsubscribe();
  });

  return () =>
    Boolean(getPubkey()) &&
    communityHasMention(community, getUnreadMentionsByGroup(), groupMetadata);
}

/**
 * The channel on screen reads its mentions: every unread mention/reply row of
 * it in the inbox is marked read — as they arrive too, so a mention sent
 * while you are looking at the channel never lights a pill. Not while the tab
 * is hidden (nobody saw them), and once more on the way back to the tab.
 * Call during component init.
 * @param {() => string | null | undefined} getGroupId
 */
export function useMarkChannelMentionsRead(getGroupId) {
  const stamp = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const groupId = getGroupId();
    if (!groupId) return;
    const ids = getUnreadMentionsByGroup().get(groupId);
    if (ids?.length) markItemsAsRead(ids);
  };

  // Reads named here, body untracked: the write must not re-trigger the
  // effect that made it (it would converge, but only by luck of the data).
  $effect(() => {
    void getGroupId();
    void getUnreadMentionsByGroup();
    untrack(stamp);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') untrack(stamp);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
}
