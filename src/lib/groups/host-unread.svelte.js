// Unread state for every channel of ONE host, from one subscription.
//
// A community folds each channel separately because each has its own store. A
// host does not: kind-9 for all of its channels comes down one REQ, split by
// `h` tag (channel-unread.js). One subscription per host also means one NIP-42
// handshake, which is the difference between a gated relay working and a gated
// relay refusing the second AUTH — see relay-auth.js.
//
// TWO effects, and the split is the same one relay-directory.svelte.js needs:
// the subscribe effect decides its `since` from the read markers, and the
// mark-read effect WRITES those markers. Marking a channel read is what
// happens every time you open one, so a reactive dependency between the two
// would tear down and rebuild the relay subscription on every click — and a
// stream that restarts is a stream that has forgotten what it was carrying.
// `untrack` is what keeps them apart; it is load-bearing, not tidiness.
//
// `known` is never guessed. A host that has not sent EOSE, or that refused,
// leaves unread UNKNOWN rather than empty: "nothing new here" and "we have not
// heard" are different sentences, and only one of them may be drawn as a quiet
// row. There is deliberately no timeout that flips it — a timer would be the
// app guessing that nothing is unread.
import { untrack } from 'svelte';
import { TimelineModel } from 'applesauce-core/models';
import { storeEvents } from 'applesauce-relay/operators';
import { eventStore, pool } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { channelKey } from './community-pointer.js';
import { readUnreadMarkers, writeUnreadMarkers } from './unread-markers.svelte.js';
import {
  foldHostSummaries,
  unreadWindowSince,
  unreadFlags,
  hostRollup,
  markRead,
  markHostRead
} from './channel-unread.js';

const GROUP_MESSAGE = 9;

/**
 * @param {string | null | undefined} relay
 * @param {string[]} ids
 * @returns {string[]}
 */
function keysFor(relay, ids) {
  if (!relay) return [];
  return (ids ?? [])
    .map((id) => channelKey({ id, relay }))
    .filter((key) => /** @type {string | null} */ (key) !== null);
}

/**
 * @param {() => string | null | undefined} getRelay
 * @param {() => string[]} getChannelIds every channel this host lists
 * @param {() => string | null | undefined} getActiveChannelId the one on screen
 * @returns {() => {
 *   loaded: boolean,
 *   flags: (id: string) => import('./channel-unread.js').UnreadFlags,
 *   host: import('./channel-unread.js').UnreadFlags,
 *   markAllRead: () => void
 * }}
 */
export function useHostUnread(getRelay, getChannelIds, getActiveChannelId) {
  const getActiveUser = useActiveUser();

  /** @type {Record<string, import('./channel-unread.js').ChannelSummary>} */
  let summaries = $state.raw({});
  let loaded = $state(false);

  // One live REQ for the whole host.
  $effect(() => {
    const relay = getRelay();
    const ids = getChannelIds() ?? [];
    const me = getActiveUser()?.pubkey;
    // Another host's summaries must never linger under this one's name.
    summaries = {};
    loaded = false;
    if (!relay || !me || ids.length === 0) return;

    const since = untrack(() =>
      unreadWindowSince(readUnreadMarkers(me), keysFor(relay, ids), Math.floor(Date.now() / 1000))
    );
    const filter = { kinds: [GROUP_MESSAGE], '#h': [...ids], since };

    const streamSub = pool
      .relay(relay)
      .subscription([filter])
      .pipe(storeEvents(eventStore))
      .subscribe({
        next: (/** @type {any} */ value) => {
          // The relay has told us it has sent everything it stored. Only now
          // is an empty channel an empty channel.
          if (value === 'EOSE') loaded = true;
        },
        // A refusal leaves `loaded` false on purpose: see the note above.
        error: () => {}
      });

    const modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      summaries = foldHostSummaries(events, me, relay);
    });

    return () => {
      streamSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  // The channel on screen is read as its messages arrive — including your own,
  // so sending a message does not leave the channel you are looking at bold.
  // Not while the tab is in the background: that would mark messages read that
  // nobody has seen (same rule as concord/notifications.svelte.js).
  $effect(() => {
    const relay = getRelay();
    const activeId = getActiveChannelId?.();
    const me = getActiveUser()?.pubkey;
    const current = summaries;
    if (!relay || !activeId || !me) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const key = channelKey({ id: activeId, relay });
    if (!key) return;
    untrack(() => {
      const markers = readUnreadMarkers(me);
      const next = markRead(markers, current, key);
      if (next !== markers) writeUnreadMarkers(me, next);
    });
  });

  return () => {
    const relay = getRelay();
    const me = getActiveUser()?.pubkey;
    // Tracked on purpose — this read is what re-renders a row when its marker
    // moves.
    const markers = readUnreadMarkers(me);
    const keys = keysFor(relay, getChannelIds() ?? []);
    return {
      loaded,
      flags: (/** @type {string} */ id) =>
        unreadFlags(summaries, markers, relay ? channelKey({ id, relay }) : null, loaded),
      host: hostRollup(summaries, markers, keys, loaded),
      markAllRead: () => {
        const next = markHostRead(markers, summaries, keys);
        if (next !== markers) writeUnreadMarkers(me, next);
      }
    };
  };
}
