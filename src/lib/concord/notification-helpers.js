// Pure helpers for Concord unread/mention/toast state (spec: docs/superpowers/
// specs/2026-07-24-concord-notifications-design.md). Zero imports — safe for
// node-env unit tests and any SSR-adjacent call site. Everything protocol-ish
// here is client-local invention: no CORD spec defines read-state or mentions,
// so these shapes only need to satisfy this app.

/** @typedef {{latest: number, latestFromOthers: number, latestMention: number}} ChannelSummary */

/** Marker/level map key for one channel. @param {string} communityId @param {string} channelId @returns {string} */
export function markerKey(communityId, channelId) {
  return `${communityId}/${channelId}`;
}

/**
 * Fold a channel's kind-9 rumor timeline into the three timestamps unread
 * logic needs. Mentions follow Armada's convention exactly: a `p` tag equal
 * to the user's pubkey on someone ELSE's decrypted rumor — never content
 * scanning, and a self-authored self-p-tag never counts.
 * @param {Array<{pubkey?: string, created_at?: number, tags?: string[][]}>} rumors
 * @param {string} myPubkey
 * @returns {ChannelSummary}
 */
export function foldChannelSummary(rumors, myPubkey) {
  let latest = 0;
  let latestFromOthers = 0;
  let latestMention = 0;
  for (const rumor of rumors ?? []) {
    const at = typeof rumor?.created_at === 'number' ? rumor.created_at : 0;
    if (!at) continue;
    if (at > latest) latest = at;
    if (rumor.pubkey === myPubkey) continue;
    if (at > latestFromOthers) latestFromOthers = at;
    const mentionsMe = (rumor.tags ?? []).some((t) => t?.[0] === 'p' && t?.[1] === myPubkey);
    if (mentionsMe && at > latestMention) latestMention = at;
  }
  return { latest, latestFromOthers, latestMention };
}

/**
 * Monotonically raise one marker. Returns the SAME object when nothing
 * changed so callers can cheap-compare before persisting/reassigning state.
 * @param {Record<string, number>} markers
 * @param {string} key
 * @param {number} timestamp
 * @returns {Record<string, number>}
 */
export function mergeMarker(markers, key, timestamp) {
  if (timestamp <= (markers[key] ?? 0)) return markers;
  return { ...markers, [key]: timestamp };
}

/**
 * Per-channel badge flags against a read marker.
 * @param {ChannelSummary | undefined} summary
 * @param {number} marker
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function summaryFlags(summary, marker) {
  if (!summary) return { unread: false, mentioned: false };
  return {
    unread: summary.latestFromOthers > marker,
    mentioned: summary.latestMention > marker
  };
}

/**
 * OR-rollup for one community's area/tab badge. The mention tier is
 * additionally gated by the community-level mention-read stamp so a mention
 * inside a channel that later became inaccessible can't wedge the accent dot.
 * @param {Record<string, ChannelSummary>} channelSummaries channelId → summary
 * @param {Record<string, number>} markers
 * @param {string} communityId
 * @param {number} mentionReadTs
 * @returns {{unread: boolean, mentioned: boolean}}
 */
export function rollupArea(channelSummaries, markers, communityId, mentionReadTs) {
  let unread = false;
  let mentioned = false;
  for (const [channelId, summary] of Object.entries(channelSummaries ?? {})) {
    const marker = markers[markerKey(communityId, channelId)] ?? 0;
    const flags = summaryFlags(summary, marker);
    if (flags.unread) unread = true;
    if (flags.mentioned && summary.latestMention > mentionReadTs) mentioned = true;
    if (unread && mentioned) break;
  }
  return { unread, mentioned };
}

/**
 * Per-channel toast level; absent = 'all' (levels gate toasts ONLY, never badges).
 * @param {Record<string, string>} levels
 * @param {string} communityId
 * @param {string} channelId
 * @returns {'all'|'mentions'|'nothing'}
 */
export function resolveLevel(levels, communityId, channelId) {
  const level = levels[markerKey(communityId, channelId)];
  return level === 'mentions' || level === 'nothing' ? level : 'all';
}

/**
 * The complete OS-toast gate (spec §6), pure so every branch is unit-testable.
 * `startTime` is the service start in unix SECONDS (cache-replay guard);
 * `lastToastAt`/`now` are Date.now() MILLISECONDS (throttle).
 * @param {{createdAt: number, isMention: boolean, level: 'all'|'mentions'|'nothing',
 *   enabled: boolean, permissionGranted: boolean, tabVisible: boolean,
 *   isActiveChannel: boolean, marker: number, startTime: number,
 *   lastToastAt: number, now: number, throttleMs?: number}} args
 * @returns {boolean}
 */
export function shouldToast(args) {
  const throttleMs = args.throttleMs ?? 30_000;
  if (!args.enabled || !args.permissionGranted) return false;
  if (args.level === 'nothing') return false;
  if (args.level === 'mentions' && !args.isMention) return false;
  if (args.createdAt <= args.marker) return false;
  if (args.createdAt <= args.startTime) return false;
  if (args.tabVisible && args.isActiveChannel) return false;
  if (args.now - args.lastToastAt < throttleMs) return false;
  return true;
}
