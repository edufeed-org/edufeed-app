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
import { OutboxModel } from 'applesauce-core/models';
import { groupPubkeysByRelay } from 'applesauce-core/helpers';
import { includeFallbackRelays } from 'applesauce-core/observable';
import { fetchEvents, fetchOutbox } from '$lib/loaders/base.js';
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
import { participationFilter } from '$lib/helpers/educational/participation.js';

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
 * "Beteiligt an": resources by OTHER authors that name one of the profiles
 * as creator/contributor through a NIP-AMB p-tag live on the educational
 * relays, not on the profile's own write relays — one `#p` loader per
 * profile, same on both paths.
 * @param {string[]} pubkeys
 * @returns {import('rxjs').Subscription[]}
 */
function startParticipationLoaders(pubkeys) {
  const relays = getEducationalRelays();
  if (relays.length === 0) return [];
  return pubkeys.map((pubkey) =>
    fetchEvents(relays, { ...participationFilter(pubkey), limit: 50 }).subscribe({
      error: (err) => console.error('profile-feed-loaders: Participation loader error:', err)
    })
  );
}

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

  subs.push(...startParticipationLoaders(pubkeys));

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

    subs.push(
      fetchOutbox(outboxMap$, { kinds: ALL_FEED_KINDS, limit: 50 }).subscribe({
        error: (err) => console.error('profile-feed-loaders: Outbox loader error:', err)
      })
    );

    // Reposts via outbox (reposts live on user write relays)
    subs.push(
      fetchOutbox(outboxMap$, { kinds: [6, 16], limit: 50 }).subscribe({
        error: (err) => console.error('profile-feed-loaders: Repost outbox loader error:', err)
      })
    );

    // Supplemental: app-specific relays for content that also lives on dedicated relays
    for (const source of FEED_RELAY_SOURCES) {
      const relays = source.getRelays();
      if (relays.length === 0) continue;

      subs.push(
        fetchEvents(relays, { kinds: source.kinds, authors: pubkeys, limit: 50 }).subscribe({
          error: (err) => console.error('profile-feed-loaders: App relay loader error:', err)
        })
      );
    }
  } else {
    // --- Classic path: all pubkeys to all relays per content type ---
    for (const source of FEED_RELAY_SOURCES) {
      const relays = source.getRelays();
      if (relays.length === 0) continue;

      subs.push(
        fetchEvents(relays, { kinds: source.kinds, authors: pubkeys, limit: 50 }).subscribe({
          error: (err) => console.error('profile-feed-loaders: Loader error:', err)
        })
      );
    }

    // Repost loader (classic path)
    const repostRelays = getProfileLookupRelays();
    if (repostRelays.length > 0) {
      subs.push(
        fetchEvents(repostRelays, { kinds: [6, 16], authors: pubkeys, limit: 50 }).subscribe({
          error: (err) => console.error('profile-feed-loaders: Repost loader error:', err)
        })
      );
    }
  }

  return subs;
}
