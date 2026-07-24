// Central Concord notifications service (spec §2): one subscription per
// accessible channel across all communities, folded into a reactive summary
// map that badge components read via plain getter functions. Runs OUTSIDE
// component context — manual RxJS subscription management, no $effect.
// Started/stopped by client.svelte.js's setup()/teardown() under the same
// account lifecycle; imports only sibling concord submodules + pure helpers,
// so any chrome component may import this file directly (SSR-clean).
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import {
  markerKey,
  foldChannelSummary,
  mergeMarker,
  summaryFlags,
  rollupArea,
  resolveLevel,
  shouldToast
} from './notification-helpers.js';
import { deriveVisibleChannels } from './community.svelte.js';
import { getActiveConcordChannel } from './active-channel.svelte.js';
import { goto } from '$app/navigation';
import { getProfileContent } from 'applesauce-core/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';
import * as m from '$lib/paraglide/messages';

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
let startTime = 0; // unix seconds — toast cache-replay guard
/** @type {Map<string, number>} */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal throttle bookkeeping, not reactive state
let lastToastAt = new Map();
let generation = 0;
/** @type {import('rxjs').Subscription | undefined} */
let communitiesSub;
/** @type {import('rxjs').Subscription | undefined} */
let inviteTickSub;
/** @type {Map<string, {community: any, lastChannels: any[], channelsSub: import('rxjs').Subscription, channelSubs: Map<string, import('rxjs').Subscription>, communityName: string, channelNames: Map<string, string>}>} */
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
 * Foreground OS toast (spec §6). Content stays minimal — channel/community
 * names and the sender's display name only, never message text (OS
 * notification centers persist content, which conflicts with sealed
 * channels). The Notification `tag` collapses bursts per channel; the pure
 * shouldToast() gate carries every suppression rule and is unit-tested in
 * concord-notification-helpers.test.js.
 * @param {string} communityId @param {string} channelId
 * @param {Array<{pubkey?: string, created_at?: number, tags?: string[][]}>} rumors
 * @param {ChannelSummary | undefined} prev @param {ChannelSummary} summary
 */
function maybeToast(communityId, channelId, rumors, prev, summary) {
  if (typeof Notification === 'undefined') return;
  if (!prev) return; // first fold for this channel = cache replay
  if (summary.latestFromOthers <= prev.latestFromOthers) return;
  // Scan every not-self rumor newer than the previous fold, not just the
  // single newest one (minor, final review): a burst emission like
  // [newer non-mention, mention] would otherwise inspect only the newer
  // non-mention and silently drop the mention at level 'mentions'. Track
  // the newest CANDIDATE (for createdAt/displayName) separately from
  // whether ANY candidate in the burst mentions the user.
  /** @type {{pubkey?: string, created_at?: number, tags?: string[][]} | undefined} */
  let newest;
  let isMention = false;
  for (const rumor of rumors ?? []) {
    if (!rumor?.pubkey || rumor.pubkey === myPubkey) continue;
    if ((rumor.created_at ?? 0) <= prev.latestFromOthers) continue;
    if (!newest || (rumor.created_at ?? 0) > (newest.created_at ?? 0)) newest = rumor;
    if ((rumor.tags ?? []).some((t) => t?.[0] === 'p' && t?.[1] === myPubkey)) isMention = true;
  }
  if (!newest) return;
  const active = getActiveConcordChannel();
  const fire = shouldToast({
    createdAt: newest.created_at ?? 0,
    isMention,
    level: resolveLevel(levels, communityId, channelId),
    enabled: toastsEnabled,
    permissionGranted: Notification.permission === 'granted',
    tabVisible: typeof document !== 'undefined' && document.visibilityState === 'visible',
    isActiveChannel: active?.communityId === communityId && active?.channelId === channelId,
    marker: readMarkers[markerKey(communityId, channelId)] ?? 0,
    startTime,
    lastToastAt: lastToastAt.get(channelId) ?? 0,
    now: Date.now()
  });
  if (!fire) return;
  lastToastAt.set(channelId, Date.now());
  const watcher = watchers.get(communityId);
  const channelName = watcher?.channelNames.get(channelId) || '#';
  const communityName = watcher?.communityName || '';
  const authorPubkey = newest.pubkey ?? ''; // guaranteed truthy by the find() predicate above
  let profile;
  try {
    const profileEvent = eventStore.getReplaceable(0, authorPubkey);
    profile = profileEvent ? getProfileContent(profileEvent) : undefined;
  } catch {
    profile = undefined;
  }
  const displayName = getUserDisplayName(authorPubkey, profile);
  const notification = new Notification(
    communityName ? `${channelName} · ${communityName}` : channelName,
    { body: m.concord_notif_toast_body({ name: displayName }), tag: `concord-${channelId}` }
  );
  notification.onclick = () => {
    window.focus();
    goto(`/private/${communityId}?channel=${channelId}`);
  };
}

/**
 * Drop one channel's read marker after the channel is CONFIRMED gone (its
 * channels$ entry disappeared while we were subscribed). Never called on
 * partial bootstrap snapshots — see markChannelRead, which no longer prunes.
 * @param {string} communityId @param {string} channelId
 */
function dropChannelMarker(communityId, channelId) {
  const key = markerKey(communityId, channelId);
  if (!(key in readMarkers)) return;
  const { [key]: _dropped, ...rest } = readMarkers;
  readMarkers = rest;
  persist(READ_KEY, readMarkers);
}

/**
 * Drop all of a community's markers after the community is CONFIRMED gone
 * (disappeared from communities$ while we had a watcher for it).
 * @param {string} communityId
 */
function dropCommunityMarkers(communityId) {
  const prefix = `${communityId}/`;
  const kept = Object.entries(readMarkers).filter(([key]) => !key.startsWith(prefix));
  if (kept.length !== Object.keys(readMarkers).length) {
    readMarkers = Object.fromEntries(kept);
    persist(READ_KEY, readMarkers);
  }
  if (communityId in mentionRead) {
    const { [communityId]: _dropped, ...rest } = mentionRead;
    mentionRead = rest;
    persist(MENTION_READ_KEY, mentionRead);
  }
}

/**
 * Diff one community's per-channel timeline subscriptions against what is
 * currently accessible. Shared by the channels$ handler AND the direct-invite
 * tick: receiveChannelKeys() mutates `community.material.channels` in place
 * without re-emitting channels$ (see community.svelte.js CARRY-FORWARD note),
 * so a mid-session key grant must re-run this diff with the LAST channels$
 * value against the freshly-mutated material.
 * @param {string} communityId
 * @param {{community: any, lastChannels: any[], channelSubs: Map<string, import('rxjs').Subscription>, channelNames: Map<string, string>}} watcher
 * @param {number} myGeneration
 */
function refreshChannelSubs(communityId, watcher, myGeneration) {
  const { community, channelSubs } = watcher;
  const held = (community.material?.channels ?? []).map((/** @type {{id: string}} */ k) => k.id);
  const visible = deriveVisibleChannels(watcher.lastChannels ?? [], held).filter(
    (c) => c.accessible
  );
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
      dropChannelMarker(communityId, channelId);
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
}

/** Diff-subscribe one community's accessible channels. @param {any} client @param {string} communityId @param {number} myGeneration */
function watchCommunity(client, communityId, myGeneration) {
  const community = client.getCommunity(communityId);
  if (!community) return;
  // channels$ is a BehaviorSubject and fires synchronously on subscribe(),
  // so `watcher` must exist (with a placeholder channelsSub) BEFORE
  // subscribing — the callback below closes over and reassigns fields on it.
  const watcher = {
    community,
    /** @type {any[]} */
    lastChannels: [],
    /** @type {Map<string, import('rxjs').Subscription>} */
    channelSubs: new Map(),
    communityName: '',
    channelNames: new Map(),
    /** @type {import('rxjs').Subscription} */
    channelsSub: /** @type {any} */ (undefined)
  };
  watcher.channelsSub = community.channels$.subscribe((/** @type {any[]} */ channels) => {
    if (myGeneration !== generation) return;
    watcher.lastChannels = channels ?? [];
    refreshChannelSubs(communityId, watcher, myGeneration);
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
      dropCommunityMarkers(communityId);
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

  // Mid-session Direct Invite key grants mutate material.channels in place
  // WITHOUT re-emitting channels$ (receiveChannelKeys — see the CARRY-FORWARD
  // note in community.svelte.js). The client's own onDirectInvite handler runs
  // synchronously inside its invites$ subscription, so re-subscribing to that
  // observable here ticks exactly after each grant lands — re-run the channel
  // diff for every watcher then. Optional-chained: clients without a
  // directInviteWatcher$ (tests, older builds) simply never tick.
  inviteTickSub = client.directInviteWatcher$
    ?.pipe(switchMap((/** @type {any} */ w) => w?.invites$ ?? of([])))
    .subscribe(() => {
      if (myGeneration !== generation) return;
      for (const [communityId, watcher] of watchers) {
        refreshChannelSubs(communityId, watcher, myGeneration);
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
  inviteTickSub?.unsubscribe();
  inviteTickSub = undefined;
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
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal throttle bookkeeping, not reactive state
  lastToastAt = new Map();
}

/**
 * Stamp a channel read up to its newest rumor (monotonic — never rewinds,
 * which also defuses far-future clock-skewed messages once viewed). Updates
 * reactive state synchronously; persists fire-and-forget. Deliberately does
 * NOT prune here: during the fully-synchronous bootstrap fan-out this can run
 * (active-channel auto-mark) while `summaries` holds only a partial snapshot,
 * and pruning against it would strip live channels' persisted markers.
 * Pruning happens only where a channel/community is CONFIRMED gone
 * (dropChannelMarker / dropCommunityMarkers).
 * @param {string} communityId @param {string} channelId
 */
export function markChannelRead(communityId, channelId) {
  const summary = summaries[communityId]?.[channelId];
  if (!summary) return;
  const key = markerKey(communityId, channelId);
  const next = mergeMarker(readMarkers, key, summary.latest);
  if (next !== readMarkers) {
    readMarkers = next;
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
