/**
 * Reactive hook: a profile's followers and the people it follows, for
 * "N Follower · M Gefolgt" and the list behind it (issue 891be310).
 *
 * Followers are the contact lists (kind 3) that p-tag the person, asked from
 * the lookup relays with a capped REQ (a big account would otherwise pull
 * thousands of large events) and read back from the EventStore — so the
 * count and the list always agree, and both are a lower bound. Following is
 * the person's own contact list. Store first: what is cached shows at once.
 *
 * MUST be called during component init (it uses $effect).
 */
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { fetchEvents } from '$lib/loaders/base.js';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
import { followersFrom, followingOf } from '$lib/helpers/follow-graph.js';

/** Contact lists asked for per profile; at this many the count reads "500+". */
export const FOLLOWER_CAP = 500;

/**
 * @param {() => string | undefined} getPubkey
 * @returns {() => { followers: string[], following: string[], capped: boolean }}
 */
export function useFollowGraph(getPubkey) {
  let followers = $state.raw(/** @type {string[]} */ ([]));
  let following = $state.raw(/** @type {string[]} */ ([]));
  let capped = $state(false);

  $effect(() => {
    const pubkey = getPubkey();
    if (!pubkey) return;
    return untrack(() => {
      followers = [];
      following = [];
      capped = false;
      const fetchSub = fetchEvents(
        getProfileLookupRelays(),
        [
          { kinds: [3], '#p': [pubkey], limit: FOLLOWER_CAP },
          { kinds: [3], authors: [pubkey], limit: 1 }
        ],
        { cache: true }
      ).subscribe();
      const followersSub = eventStore
        .model(TimelineModel, { kinds: [3], '#p': [pubkey] })
        .subscribe((/** @type {any[]} */ events) => {
          followers = followersFrom(events || [], pubkey);
          capped = followers.length >= FOLLOWER_CAP;
        });
      const followingSub = eventStore
        .replaceable(3, pubkey)
        .subscribe((/** @type {any} */ event) => {
          following = followingOf(event);
        });
      return () => {
        fetchSub.unsubscribe();
        followersSub.unsubscribe();
        followingSub.unsubscribe();
      };
    });
  });

  return () => ({ followers, following, capped });
}
