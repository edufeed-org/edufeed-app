// Central Concord notifications service (spec §2): one subscription per
// accessible channel across all communities, folded into a reactive summary
// map that badge components read via plain getter functions. Runs OUTSIDE
// component context — manual RxJS subscription management, no $effect.
// Started/stopped by client.svelte.js's setup()/teardown() under the same
// account lifecycle; imports only sibling concord submodules + pure helpers,
// so any chrome component may import this file directly (SSR-clean).
import {
  markerKey,
  foldChannelSummary,
  mergeMarker,
  summaryFlags,
  rollupArea,
  resolveLevel,
  pruneMarkers
} from './notification-helpers.js';
import { deriveVisibleChannels } from './community.svelte.js';
import { getActiveConcordChannel } from './active-channel.svelte.js';

const READ_KEY = 'notif:read';
const MENTION_READ_KEY = 'notif:mention-read';
const LEVELS_KEY = 'notif:levels';
export const TOASTS_ENABLED_KEY = 'notif:toasts-enabled';

/** @typedef {import('./notification-helpers.js').ChannelSummary} ChannelSummary */

// Reactive surface — reassigned whole, never mutated ($state.raw rule).
let summaries = $state.raw(/** @type {Record<string, Record<string, ChannelSummary>>} */ ({}));
let readMarkers = $state.raw(/** @type {Record<string, number>} */ ({}));
let mentionRead = $state.raw(/** @type {Record<string, number>} */ ({}));
let levels = $state.raw(/** @type {Record<string, string>} */ ({}));
let toastsEnabled = $state.raw(false);

// Non-reactive service internals.
/** @type {import('./storage.js').ConcordStorage | undefined} */
let storage;
let myPubkey = '';
// eslint-disable-next-line no-unused-vars -- read by maybeToast once Task 9 fills it in
let startTime = 0; // unix seconds — toast cache-replay guard (Task 9)
let generation = 0;
/** @type {import('rxjs').Subscription | undefined} */
let communitiesSub;
/** @type {Map<string, {channelsSub: import('rxjs').Subscription, channelSubs: Map<string, import('rxjs').Subscription>, communityName: string, channelNames: Map<string, string>}>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping (subscriptions), not reactive state
let watchers = new Map();
/** @type {(() => void) | undefined} */
let removeVisibilityListener;

/** Parse a stored JSON object, tolerating null/corruption. @param {string|null} raw */
function parseMap(raw) {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Fire-and-forget persist — kv failure degrades to session-only markers. @param {string} key @param {unknown} value */
function persist(key, value) {
  storage?.setItem(key, JSON.stringify(value)).catch((error) => {
    console.warn('concord: notification state persist failed', error);
  });
}

/** @param {string} communityId @param {string} channelId @param {any[]} rumors */
function onChannelRumors(communityId, channelId, rumors) {
  const prev = summaries[communityId]?.[channelId];
  const summary = foldChannelSummary(rumors, myPubkey);
  summaries = {
    ...summaries,
    [communityId]: { ...(summaries[communityId] ?? {}), [channelId]: summary }
  };
  const active = getActiveConcordChannel();
  if (
    active?.communityId === communityId &&
    active?.channelId === channelId &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    markChannelRead(communityId, channelId);
  }
  maybeToast(communityId, channelId, rumors, prev, summary);
}

/**
 * Toast dispatcher stub — Task 9 fills this in (gates + Notification). Kept
 * as a named function so the fan-out above never changes.
 * @param {string} _communityId @param {string} _channelId @param {any[]} _rumors
 * @param {ChannelSummary | undefined} _prev @param {ChannelSummary} _summary
 */
function maybeToast(_communityId, _channelId, _rumors, _prev, _summary) {}

/** Diff-subscribe one community's accessible channels. @param {any} client @param {string} communityId @param {number} myGeneration */
function watchCommunity(client, communityId, myGeneration) {
  const community = client.getCommunity(communityId);
  if (!community) return;
  /** @type {Map<string, import('rxjs').Subscription>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping (subscriptions), not reactive state
  const channelSubs = new Map();
  // channels$ is a BehaviorSubject and fires synchronously on subscribe(),
  // so `watcher` must exist (with a placeholder channelsSub) BEFORE
  // subscribing — the callback below closes over and reassigns fields on it.
  const watcher = {
    channelSubs,
    communityName: '',
    channelNames: new Map(),
    /** @type {import('rxjs').Subscription} */
    channelsSub: /** @type {any} */ (undefined)
  };
  watcher.channelsSub = community.channels$.subscribe((/** @type {any[]} */ channels) => {
    if (myGeneration !== generation) return;
    const held = (community.material?.channels ?? []).map((/** @type {{id: string}} */ k) => k.id);
    const visible = deriveVisibleChannels(channels ?? [], held).filter((c) => c.accessible);
    const liveIds = new Set(visible.map((c) => c.channel_id));
    watcher.channelNames = new Map(visible.map((c) => [c.channel_id, c.name ?? '']));
    for (const [channelId, sub] of channelSubs) {
      if (!liveIds.has(channelId)) {
        sub.unsubscribe();
        channelSubs.delete(channelId);
        if (summaries[communityId]?.[channelId]) {
          const { [channelId]: _gone, ...rest } = summaries[communityId];
          summaries = { ...summaries, [communityId]: rest };
        }
      }
    }
    for (const channel of visible) {
      if (channelSubs.has(channel.channel_id)) continue;
      channelSubs.set(
        channel.channel_id,
        community
          .channelStore(channel.channel_id)
          .timeline([{ kinds: [9] }])
          .subscribe((/** @type {any[]} */ rumors) => {
            if (myGeneration !== generation) return;
            onChannelRumors(communityId, channel.channel_id, rumors ?? []);
          })
      );
    }
  });
  watchers.set(communityId, watcher);
}

/**
 * Start the service for one account. Idempotent per start/stop cycle — the
 * caller (client.svelte.js) stops before any restart. Markers are loaded
 * BEFORE the fan-out subscribes so a reload never flashes all-unread.
 * @param {{client: any, storage: import('./storage.js').ConcordStorage, pubkey: string}} args
 */
export async function startConcordNotifications({ client, storage: kv, pubkey }) {
  stopConcordNotifications();
  generation += 1;
  const myGeneration = generation;
  storage = kv;
  myPubkey = pubkey;
  startTime = Math.floor(Date.now() / 1000);

  const [readRaw, mentionRaw, levelsRaw, enabledRaw] = await Promise.all([
    kv.getItem(READ_KEY).catch(() => null),
    kv.getItem(MENTION_READ_KEY).catch(() => null),
    kv.getItem(LEVELS_KEY).catch(() => null),
    kv.getItem(TOASTS_ENABLED_KEY).catch(() => null)
  ]);
  if (myGeneration !== generation) return; // superseded while loading
  readMarkers = parseMap(readRaw);
  mentionRead = parseMap(mentionRaw);
  levels = parseMap(levelsRaw);
  toastsEnabled = enabledRaw === '1';

  communitiesSub = client.communities$.subscribe((/** @type {any[]} */ communities) => {
    if (myGeneration !== generation) return;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, ephemeral dedup, not reactive state
    const liveIds = new Set(
      (communities ?? [])
        .map((c) => c?.material?.community_id)
        .filter((/** @type {string|undefined} */ id) => !!id)
    );
    for (const [communityId, watcher] of watchers) {
      if (liveIds.has(communityId)) continue;
      watcher.channelsSub.unsubscribe();
      for (const sub of watcher.channelSubs.values()) sub.unsubscribe();
      watchers.delete(communityId);
      if (summaries[communityId]) {
        const { [communityId]: _gone, ...rest } = summaries;
        summaries = rest;
      }
    }
    for (const communityState of communities ?? []) {
      const communityId = communityState?.material?.community_id;
      if (!communityId || watchers.has(communityId)) continue;
      watchCommunity(client, communityId, myGeneration);
      const watcher = watchers.get(communityId);
      if (watcher) {
        watcher.communityName =
          communityState?.metadata?.name || communityState?.material?.name || '';
      }
    }
  });

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    const active = getActiveConcordChannel();
    if (active) markChannelRead(active.communityId, active.channelId);
  };
  document.addEventListener('visibilitychange', onVisibility);
  removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisibility);
}

export function stopConcordNotifications() {
  generation += 1;
  communitiesSub?.unsubscribe();
  communitiesSub = undefined;
  for (const watcher of watchers.values()) {
    watcher.channelsSub.unsubscribe();
    for (const sub of watcher.channelSubs.values()) sub.unsubscribe();
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping (subscriptions), not reactive state
  watchers = new Map();
  removeVisibilityListener?.();
  removeVisibilityListener = undefined;
  storage = undefined;
  myPubkey = '';
  summaries = {};
  readMarkers = {};
  mentionRead = {};
  levels = {};
  toastsEnabled = false;
}

/**
 * Stamp a channel read up to its newest rumor (monotonic — never rewinds,
 * which also defuses far-future clock-skewed messages once viewed). Updates
 * reactive state synchronously; persists fire-and-forget. Prunes markers of
 * gone channels lazily on save.
 * @param {string} communityId @param {string} channelId
 */
export function markChannelRead(communityId, channelId) {
  const summary = summaries[communityId]?.[channelId];
  if (!summary) return;
  const key = markerKey(communityId, channelId);
  const next = mergeMarker(readMarkers, key, summary.latest);
  if (next !== readMarkers) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, ephemeral dedup, not reactive state
    const liveKeys = new Set();
    for (const [cid, channels] of Object.entries(summaries)) {
      for (const chid of Object.keys(channels)) liveKeys.add(markerKey(cid, chid));
    }
    readMarkers = pruneMarkers(next, liveKeys);
    persist(READ_KEY, readMarkers);
  }
  if (summary.latestMention > (mentionRead[communityId] ?? 0)) {
    mentionRead = { ...mentionRead, [communityId]: summary.latestMention };
    persist(MENTION_READ_KEY, mentionRead);
  }
}

/**
 * Reactive per-channel badge flags — safe to call from templates/$derived
 * (reads module $state only, registers reactive deps at the call site).
 * @param {string|undefined} communityId @param {string|undefined} channelId
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function channelUnreadState(communityId, channelId) {
  if (!communityId || !channelId) return { unread: false, mentioned: false };
  return summaryFlags(
    summaries[communityId]?.[channelId],
    readMarkers[markerKey(communityId, channelId)] ?? 0
  );
}

/**
 * Reactive area/tab rollup for one community.
 * @param {string|undefined} communityId
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function areaUnreadState(communityId) {
  if (!communityId) return { unread: false, mentioned: false };
  return rollupArea(
    summaries[communityId] ?? {},
    readMarkers,
    communityId,
    mentionRead[communityId] ?? 0
  );
}

/** @param {string} communityId @param {string} channelId @returns {'all'|'mentions'|'nothing'} */
export function getChannelLevel(communityId, channelId) {
  return resolveLevel(levels, communityId, channelId);
}

/** @param {string} communityId @param {string} channelId @param {'all'|'mentions'|'nothing'} level */
export async function setChannelLevel(communityId, channelId, level) {
  levels = { ...levels, [markerKey(communityId, channelId)]: level };
  persist(LEVELS_KEY, levels);
}

/** @returns {boolean} */
export function getToastsEnabled() {
  return toastsEnabled;
}

/** @param {boolean} enabled */
export async function setToastsEnabled(enabled) {
  toastsEnabled = enabled;
  // Stored as the raw '1'/'0' string (not JSON) so callers/tests can assert
  // the literal value; persist() would JSON-stringify it to '"1"'/'"0"'.
  try {
    await storage?.setItem(TOASTS_ENABLED_KEY, enabled ? '1' : '0');
  } catch (error) {
    console.warn('concord: notification state persist failed', error);
  }
}
