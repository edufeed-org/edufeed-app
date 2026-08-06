// Which container in the rail is the one currently on screen?
//
// The rail held exactly one kind of "you are here": the ring on a joined
// community, driven by a pubkey the community layout had already resolved. A
// Concord area and a NIP-29 host are containers too, and both are addressed by
// URL alone — so opening one left every icon in the rail looking unselected.
//
// The route is therefore the source, with the community pubkey kept as the one
// exception it has to be: `/c/<npub>` addresses a community by an encoding the
// layout has already decoded, and re-deriving it here would be a second,
// drifting decoder for the same fact.
//
// Pure. The reactive plumbing stays in CommunitySidebar.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { parseGroupInput } from '$lib/groups/groups.js';

/**
 * @typedef {{kind: 'community', pubkey: string}} CommunityTarget
 * @typedef {{kind: 'area', communityId: string}} AreaTarget
 * @typedef {{kind: 'relay', relay: string}} RelayTarget
 * @typedef {CommunityTarget | AreaTarget | RelayTarget | null} RailTarget
 */

/** A path segment, or null when it is not a valid escape sequence. */
function decodeSegment(/** @type {string} */ segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    // `%` alone throws. A rail that dies on a malformed URL is worse than a
    // rail that highlights nothing.
    return null;
  }
}

/**
 * The host route you are on: which relay, and which of its channels is open.
 *
 * Two surfaces need this, and they must never disagree. The rail wants only
 * the host (a channel IS a group and a group lives on exactly one host, so
 * reading a channel is being inside that host). The channel sidebar wants the
 * host AND the channel, to mark the row you are reading — and on a relay's
 * directory there is no channel open, which is a state and not a failure.
 *
 * @param {string | null | undefined} pathname
 * @returns {{relay: string, channelId: string | null} | null}
 */
export function hostRouteOf(pathname) {
  const [head, tail] = String(pathname ?? '')
    .split('/')
    .filter(Boolean);
  if (!head || !tail) return null;
  const raw = decodeSegment(tail);
  if (!raw) return null;

  if (head === 'relays') return { relay: raw, channelId: null };
  if (head === 'groups') {
    const pointer = parseGroupInput(raw);
    return pointer?.relay ? { relay: pointer.relay, channelId: pointer.id } : null;
  }
  return null;
}

/**
 * The container the current route is inside, or null for a route that is
 * inside none of them.
 *
 * @param {{pathname?: string, communityPubkey?: string | null, isDashboardActive?: boolean}} input
 * @returns {RailTarget}
 */
export function activeRailTarget({
  pathname = '',
  communityPubkey = null,
  isDashboardActive = false
} = {}) {
  // The dashboard is a route inside the community section but inside no
  // community — the rail already draws its own ring on the Home button.
  if (isDashboardActive) return null;
  if (communityPubkey) return { kind: 'community', pubkey: communityPubkey };

  // A channel route is the host's route as far as the rail is concerned — the
  // same decoder the sidebar reads, so the two cannot drift.
  const host = hostRouteOf(pathname);
  if (host) return { kind: 'relay', relay: host.relay };

  const [head, tail] = String(pathname ?? '')
    .split('/')
    .filter(Boolean);
  if (!head || !tail) return null;

  if (head === 'private') {
    const communityId = decodeSegment(tail);
    return communityId ? { kind: 'area', communityId } : null;
  }
  return null;
}

/** Two spellings of one host. Falls back to a plain compare for unparseable input. */
function sameRelay(/** @type {string} */ a, /** @type {string} */ b) {
  try {
    return normalizeURL(a) === normalizeURL(b);
  } catch {
    return a === b;
  }
}

/**
 * Is this rail entry the container named by `target`?
 *
 * @param {import('./rail-entries.js').RailEntry | null | undefined} entry
 * @param {RailTarget} target
 * @returns {boolean}
 */
export function isEntryActive(entry, target) {
  if (!entry || !target || entry.kind !== target.kind) return false;
  if (entry.kind === 'community' && target.kind === 'community')
    return !!entry.pubkey && entry.pubkey === target.pubkey;
  if (entry.kind === 'area' && target.kind === 'area')
    return !!entry.area?.communityId && entry.area.communityId === target.communityId;
  if (entry.kind === 'relay' && target.kind === 'relay')
    return !!entry.relay && sameRelay(entry.relay, target.relay);
  return false;
}
