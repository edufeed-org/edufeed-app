// Unread and mention state for a host's NIP-29 channels. Pure.
//
// The RULES are Concord's, imported rather than restated: a mention is a `p`
// tag on someone ELSE's message and never a text match, a marker only ever
// moves forward, and unread is `latestFromOthers > marker`. Two rails that
// disagree about what "unread" means would be worse than one rail without it,
// and `notification-helpers.js` is already pure, zero-import and unit-tested.
//
// What is genuinely new here is the SHAPE of the input. A community folds one
// channel at a time, because each Concord channel is its own decrypted rumor
// store. A host answers ONE kind-9 stream for all of its channels at once, and
// which channel a message belongs to is in its `h` tag — so the fold has to
// split before it can summarise.
//
// The third state is the other new thing. A community's channel is loaded or
// it is not; a host may simply not have answered yet, and "no unread" and "not
// heard from" must not be the same value. Every reader here therefore takes an
// explicit `loaded` and hands back `known`.
import {
  foldChannelSummary,
  summaryFlags,
  mergeMarker
} from '$lib/concord/notification-helpers.js';
import { channelKey } from './community-pointer.js';

/** @typedef {import('$lib/concord/notification-helpers.js').ChannelSummary} ChannelSummary */
/** @typedef {{unread: boolean, mentioned: boolean, known: boolean}} UnreadFlags */

/** How far back an unmarked channel is asked for. Matches the inbox's own. */
export const UNREAD_LOOKBACK = 604_800; // 7 days
/** The furthest back the window may ever reach, whatever the markers say. */
export const UNREAD_MAX_LOOKBACK = 2_592_000; // 30 days

/**
 * One host's kind-9 stream, split by `h` tag and folded per channel.
 *
 * A message with no `h` tag is dropped rather than pooled under some default:
 * on a NIP-29 relay that tag IS the channel, so a message without one belongs
 * to no channel this rail can show.
 *
 * @param {Array<{pubkey?: string, created_at?: number, tags?: string[][]}>} events
 * @param {string} myPubkey
 * @param {string} relay
 * @returns {Record<string, ChannelSummary>} channelKey → summary
 */
export function foldHostSummaries(events, myPubkey, relay) {
  /** @type {Record<string, Array<{pubkey?: string, created_at?: number, tags?: string[][]}>>} */
  const byChannel = {};
  for (const event of events ?? []) {
    const id = (event?.tags ?? []).find((t) => t?.[0] === 'h')?.[1];
    // One gate, not two: channelKey already rejects a missing id, and a second
    // `if (!id)` above it is a line no test can ever measure — deleting it left
    // the whole battery green, which is how it was found.
    const key = channelKey({ id, relay });
    if (!key) continue;
    (byChannel[key] ??= []).push(event);
  }
  /** @type {Record<string, ChannelSummary>} */
  const summaries = {};
  for (const [key, list] of Object.entries(byChannel)) {
    summaries[key] = foldChannelSummary(list, myPubkey);
  }
  return summaries;
}

/**
 * How far back to ask this host for messages.
 *
 * Back to the OLDEST marker among the channels on screen, not to a fixed
 * window: a channel left unread for ten days must still be unread when you
 * come back, and a window that ends before its newest message would quietly
 * mark it read. An unmarked channel counts as the default lookback, and the
 * whole thing is floored, because a marker from years ago must not turn one
 * subscription into a full history sync.
 *
 * @param {Record<string, number>} markers
 * @param {string[]} keys channels currently on screen
 * @param {number} now unix seconds
 * @returns {number} unix seconds
 */
export function unreadWindowSince(markers, keys, now) {
  const fallback = now - UNREAD_LOOKBACK;
  // Starts at the newest possible value and only ever moves BACK, so a host
  // whose channels were all read an hour ago is asked for an hour, not a week.
  // Seeding it with the default instead would make the default a floor, and
  // the window would never tighten below it whatever the markers said.
  let since = Number.POSITIVE_INFINITY;
  for (const key of keys ?? []) {
    const marker = markers?.[key];
    const at = typeof marker === 'number' ? marker : fallback;
    if (at < since) since = at;
  }
  if (!Number.isFinite(since)) since = fallback;
  return Math.max(since, now - UNREAD_MAX_LOOKBACK);
}

/**
 * Badge state for one channel.
 * @param {Record<string, ChannelSummary>} summaries
 * @param {Record<string, number>} markers
 * @param {string | null | undefined} key
 * @param {boolean} loaded has this host answered at all?
 * @returns {UnreadFlags}
 */
export function unreadFlags(summaries, markers, key, loaded) {
  if (!loaded || !key) return { unread: false, mentioned: false, known: false };
  return { ...summaryFlags(summaries?.[key], markers?.[key] ?? 0), known: true };
}

/**
 * OR-rollup over the channels this host currently lists.
 *
 * Deliberately over `keys` and not over every summary held: a mention in a
 * channel that has since become inaccessible would otherwise wedge the host
 * badge on with no row left to clear it. Concord needs a separate
 * mention-read stamp for exactly that case; scoping to the live list removes
 * the need for one.
 *
 * @param {Record<string, ChannelSummary>} summaries
 * @param {Record<string, number>} markers
 * @param {string[]} keys
 * @param {boolean} loaded
 * @returns {UnreadFlags}
 */
export function hostRollup(summaries, markers, keys, loaded) {
  if (!loaded) return { unread: false, mentioned: false, known: false };
  let unread = false;
  let mentioned = false;
  for (const key of keys ?? []) {
    const flags = summaryFlags(summaries?.[key], markers?.[key] ?? 0);
    if (flags.unread) unread = true;
    if (flags.mentioned) mentioned = true;
    if (unread && mentioned) break;
  }
  return { unread, mentioned, known: true };
}

/**
 * Stamp one channel read, at its newest message — including your own, so
 * sending a message does not leave the channel you are looking at bold.
 * Returns the SAME object when nothing moved, so a caller can skip the write.
 * @param {Record<string, number>} markers
 * @param {Record<string, ChannelSummary>} summaries
 * @param {string | null | undefined} key
 * @returns {Record<string, number>}
 */
export function markRead(markers, summaries, key) {
  const summary = key ? summaries?.[key] : undefined;
  if (!summary) return markers;
  return mergeMarker(markers, /** @type {string} */ (key), summary.latest);
}

/**
 * Stamp every channel this host lists. Same identity contract as markRead.
 * @param {Record<string, number>} markers
 * @param {Record<string, ChannelSummary>} summaries
 * @param {string[]} keys
 * @returns {Record<string, number>}
 */
export function markHostRead(markers, summaries, keys) {
  let next = markers;
  for (const key of keys ?? []) {
    next = markRead(next, summaries, key);
  }
  return next;
}
