/**
 * Profile feed loaders — start the network loaders that populate the
 * EventStore with a user's feed content (all feed kinds + reposts).
 *
 * Extracted from ProfileFeedView so the profile page can hoist loading to
 * page level (one loader set shared by all tabs) while the dashboard keeps
 * using ProfileFeedView standalone. Models subscribe separately; this module
 * only fetches.
 */
import { map, filter } from 'rxjs';
import { createTimelineLoader, createOutboxTimelineLoader } from 'applesauce-loaders/loaders';
import { OutboxModel } from 'applesauce-core/models';
import { groupPubkeysByRelay } from 'applesauce-core/helpers';
import { includeFallbackRelays } from 'applesauce-core/observable';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import {
  getProfileLookupRelays,
  getCalendarRelays,
  getEducationalRelays,
  getArticleRelays,
  getAllLookupRelays,
  getCommunikeyRelays
} from '$lib/helpers/relay-helper.js';
import { ALL_FEED_KINDS } from '$lib/helpers/profile-feed.js';

/** Feed source config: kinds → relay function. Used directly on the classic
 *  path; on the outbox path the same sources supplement the user's write
 *  relays with the app's dedicated content relays. */
export const FEED_RELAY_SOURCES = [
  { kinds: [1], getRelays: getProfileLookupRelays },
  { kinds: [31922, 31923], getRelays: getCalendarRelays },
  { kinds: [30142], getRelays: getEducationalRelays },
  { kinds: [30023], getRelays: getArticleRelays },
  { kinds: [39701, 9802, 1111], getRelays: getAllLookupRelays },
  { kinds: [1068], getRelays: getCommunikeyRelays }
];

/**
 * Start all feed loaders for the given authors. Relay getters are resolved
 * at call time — callers inside $effect should invoke this via untrack (or a
 * timeout) to avoid registering relay-config dependencies.
 *
 * @param {{ pubkeys: string[], userPubkey?: string | null }} options
 * @returns {import('rxjs').Subscription[]} live subscriptions; caller unsubscribes on cleanup
 */
export function startProfileFeedLoaders({ pubkeys, userPubkey = null }) {
  /** @type {import('rxjs').Subscription[]} */
  const subs = [];
  if (!pubkeys?.length) return subs;

  if (userPubkey) {
    // --- Outbox path: uses OutboxModel to send targeted filters per relay ---
    const outboxMap$ = eventStore
      .model(OutboxModel, userPubkey, {
        type: 'outbox',
        maxConnections: 20,
        maxRelaysPerUser: 3
      })
      .pipe(
        filter((pointers) => pointers != null && pointers.length > 0),
        includeFallbackRelays(runtimeConfig.fallbackRelays || []),
        map((pointers) => groupPubkeysByRelay(pointers))
      );

    const feedLoader = createOutboxTimelineLoader(
      timedPool,
      outboxMap$,
      { kinds: ALL_FEED_KINDS, limit: 50 },
      { eventStore }
    );
    subs.push(
      feedLoader().subscribe({
        error: (err) => console.error('profile-feed-loaders: Outbox loader error:', err)
      })
    );

    // Repost loader via outbox (reposts live on user write relays)
    const repostOutboxLoader = createOutboxTimelineLoader(
      timedPool,
      outboxMap$,
      { kinds: [6, 16], limit: 50 },
      { eventStore }
    );
    subs.push(
      repostOutboxLoader().subscribe({
        error: (err) => console.error('profile-feed-loaders: Repost outbox loader error:', err)
      })
    );

    // Supplemental: app-specific relays for content that also lives on dedicated relays
    for (const source of FEED_RELAY_SOURCES) {
      const relays = source.getRelays();
      if (relays.length === 0) continue;

      const appFilter = { kinds: source.kinds, authors: pubkeys, limit: 50 };
      const loader = createTimelineLoader(timedPool, relays, appFilter, { eventStore });
      subs.push(
        loader().subscribe({
          error: (err) => console.error('profile-feed-loaders: App relay loader error:', err)
        })
      );
    }
  } else {
    // --- Classic path: all pubkeys to all relays per content type ---
    for (const source of FEED_RELAY_SOURCES) {
      const relays = source.getRelays();
      if (relays.length === 0) continue;

      const sourceFilter = { kinds: source.kinds, authors: pubkeys, limit: 50 };
      const loader = createTimelineLoader(timedPool, relays, sourceFilter, { eventStore });
      subs.push(
        loader().subscribe({
          error: (err) => console.error('profile-feed-loaders: Loader error:', err)
        })
      );
    }

    // Repost loader (classic path)
    const repostRelays = getProfileLookupRelays();
    if (repostRelays.length > 0) {
      const repostLoader = createTimelineLoader(
        timedPool,
        repostRelays,
        { kinds: [6, 16], authors: pubkeys, limit: 50 },
        { eventStore }
      );
      subs.push(
        repostLoader().subscribe({
          error: (err) => console.error('profile-feed-loaders: Repost loader error:', err)
        })
      );
    }
  }

  return subs;
}
