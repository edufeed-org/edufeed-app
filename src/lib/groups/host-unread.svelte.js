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

// Hosts that answered EOSE at least once THIS SESSION, keyed `${me}|${relay}`.
// Their messages are still in the EventStore, so a remount can draw its marks
// from what the session already knows instead of holding everything back for
// a fresh round-trip — that wait is what made the dots pop in seconds after
// every host switch. This is stale-while-revalidate, not guessing: `known` is
// still never assumed for a host that has not answered once.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- session cache, not reactive state
const eosedThisSession = new Set();

/** Test seam: forget which hosts have answered. */
export function __resetHostUnreadSession() {
  eosedThisSession.clear();
}

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

  // A fresh ids ARRAY with the same content must not re-run the subscribe
  // effect. host.rows recomputes on every streaming metadata event, and its
  // flatMap mints a new array each time; keying the effect on that identity
  // reopened the REQ per event — on a 1277-channel host that exhausted the
  // relay's subscription cap and starved every later REQ on the connection.
  // A string is compared by value, so the effect only sees real set changes.
  const idsKey = $derived.by(() => {
    const ids = getChannelIds() ?? [];
    return [...ids].sort().join('');
  });

  // One live REQ for the whole host.
  $effect(() => {
    const relay = getRelay();
    const key = idsKey;
    const me = getActiveUser()?.pubkey;
    // Hygiene, not correctness, and worth saying so: summaries are keyed by
    // `id@relay`, so another host's could never be READ under this one's name,
    // and `loaded` already covers the gap until the new host answers. Deleting
    // this line leaves every test green — it is here to stop the map growing
    // for the lifetime of the tab as you move between hosts.
    summaries = {};
    loaded = relay && me ? eosedThisSession.has(`${me}|${relay}`) : false;
    if (!relay || !me || key === '') return;
    const ids = key.split('');

    /** @type {import('rxjs').Subscription | undefined} */ let streamSub;
    /** @type {import('rxjs').Subscription | undefined} */ let modelSub;
    // Debounce: while the directory is still streaming, the channel set grows
    // many times in a burst; one REQ at the end covers them all.
    const timer = setTimeout(() => {
      const since = untrack(() =>
        unreadWindowSince(readUnreadMarkers(me), keysFor(relay, ids), Math.floor(Date.now() / 1000))
      );
      const filter = { kinds: [GROUP_MESSAGE], '#h': [...ids], since };

      streamSub = pool
        .relay(relay)
        .subscription([filter])
        .pipe(storeEvents(eventStore))
        .subscribe({
          next: (/** @type {any} */ value) => {
            // The relay has told us it has sent everything it stored. Only now
            // is an empty channel an empty channel.
            if (value === 'EOSE') {
              loaded = true;
              eosedThisSession.add(`${me}|${relay}`);
            }
          },
          // A refusal leaves `loaded` false on purpose: see the note above.
          error: () => {}
        });

      modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
        summaries = foldHostSummaries(events, me, relay);
      });
    }, 300);

    return () => {
      clearTimeout(timer);
      streamSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  // The channel on screen is read as its messages arrive — including your own,
  // so sending a message does not leave the channel you are looking at bold.
  // Not while the tab is in the background: that would mark messages read that
  // nobody has seen.
  const stampActive = () => {
    const relay = getRelay();
    const activeId = getActiveChannelId?.();
    const me = getActiveUser()?.pubkey;
    if (!relay || !activeId || !me) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const key = channelKey({ id: activeId, relay });
    if (!key) return;
    const markers = readUnreadMarkers(me);
    const next = markRead(markers, summaries, key);
    if (next !== markers) writeUnreadMarkers(me, next);
  };

  // As messages arrive. The reads are named here and the body is untracked, so
  // writing a marker cannot re-trigger the effect that wrote it.
  $effect(() => {
    void getRelay();
    void getActiveChannelId?.();
    void getActiveUser()?.pubkey;
    void summaries;
    untrack(stampActive);
  });

  // And on the way back to the tab — the OTHER half of the rule, which Concord
  // has as well (notifications.svelte.js:353-359). Suppressing the stamp while
  // hidden without this leaves the channel you are looking at bold until the
  // next message happens to arrive, and nothing else can catch it: coming back
  // to a tab changes no rune, and `document.visibilityState` is a DOM property,
  // so reading it inside an effect creates no dependency on it.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') untrack(stampActive);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
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
