/**
 * Pure community-navigation logic shared by ContentNavSidebar (desktop) and
 * BottomTabBar (mobile). Both components used to carry a byte-identical copy
 * of "compute the tab list, then splice in a 'channels' tab" — extracted here
 * so there is exactly one place that decides the tab order. Label/icon maps
 * stay in the components; this module only ever deals in tab id strings.
 */
import { getCommunityTabs } from '$lib/helpers/contentTypes.js';
import { shouldShowChannelsTab } from '$lib/concord/community.svelte.js';
import { parseMembershipPointer } from '$lib/groups/community-membership.js';
import { uniqueBy } from '$lib/helpers/unique.js';

/**
 * Ordered tab ids for a community's nav (sidebar rail or bottom dock),
 * including the spliced-in 'channels' tab when `shouldShowChannelsTab` says
 * it belongs. Insert position: right after 'chat' so it sits next to the
 * public channels — but a strict-content community may have no 'chat' tab
 * at all (`getCommunityTabs` can omit it), in which case it goes right
 * before the trailing 'settings' tab instead, so 'home' always stays first.
 *
 * @param {{
 *   communityEvent: any,
 *   concordEnabled: boolean,
 *   pointer: object | undefined,
 *   isMember: boolean,
 *   hasGroupChannels: boolean
 * }} args
 * @returns {string[]}
 */
export function communityNavTabIds({
  communityEvent,
  concordEnabled,
  pointer,
  isMember,
  hasGroupChannels
}) {
  const base = getCommunityTabs(communityEvent);
  const showChannels = shouldShowChannelsTab({
    enabled: concordEnabled,
    pointer,
    isMember,
    hasGroupChannels,
    // Derived here from the event itself (not a caller input) so
    // ContentNavSidebar/BottomTabBar didn't need a new prop for it.
    hasMembershipPointer: !!parseMembershipPointer(communityEvent)
  });
  if (!showChannels) return base;

  const ids = [...base];
  const chatIndex = ids.indexOf('chat');
  const insertAt = chatIndex === -1 ? ids.length - 1 : chatIndex + 1;
  ids.splice(insertAt, 0, 'channels');
  return ids;
}

/**
 * Splits a community's tab ids + channel rows into the desktop sidebar's two
 * zones (design: `docs/superpowers/specs/2026-08-12-groups-architecture-design.md`
 * "one sidebar, two zones"). Pure — the component wires this to real inputs
 * and renders the result; no rendering decisions live here.
 *
 * Visitor filtering: a member or the owner sees every channel row; anyone
 * else sees only `worldReadable` rows (mirrors `shouldShowChannelsTab`'s own
 * owner/member carve-out for the tab itself). `showLockHint` is true only
 * when that filtering actually hid something — a visitor community with
 * nothing but world-readable channels gets no hint.
 *
 * Owner create-entry: buildSidebarZones drops the 'channels' tab id and the
 * component only renders the zone when it has content — so a community with
 * ZERO channels had no desktop path to the channels view at all, and its
 * owner no way to create the first channel (laoc, 2026-08-14). When the
 * owner's tab list carries 'channels', `showCreateEntry` asks the component
 * to render a create row. Not gated on empty rows: since the desktop layout
 * dropped PrivateChannelsView's own rail (laoc, 2026-08-17 — the "double
 * sidebar"), this zone is the ONLY desktop channel surface, so the create
 * entry must be reachable with channels present too.
 *
 * @param {{
 *   tabs: string[],
 *   channelRows: Array<{key: string, worldReadable: boolean}>,
 *   isMember: boolean,
 *   isOwner: boolean
 * }} args
 * @returns {{inhalte: string[], kanaele: any[], footer: string[], showLockHint: boolean, showCreateEntry: boolean}}
 */
export function buildSidebarZones({ tabs, channelRows, isMember, isOwner }) {
  const excluded = new Set(['home', 'channels', 'settings', 'members']);
  const inhalte = (tabs ?? []).filter((id) => !excluded.has(id));

  const deduped = uniqueBy(channelRows ?? [], (row) => row.key);
  const canSeeAll = isMember || isOwner;
  const kanaele = canSeeAll ? deduped : deduped.filter((row) => row.worldReadable);
  const showLockHint = !canSeeAll && kanaele.length < deduped.length;
  const showCreateEntry = isOwner && (tabs ?? []).includes('channels');

  return {
    inhalte,
    kanaele,
    footer: ['members', 'settings'],
    showLockHint,
    showCreateEntry
  };
}

/**
 * Zone-membership signal for `buildSidebarZones`' visitor filter (review of
 * 187b4c0b, critical 2). Deliberately NOT the kind-30000 follow-set flag —
 * that list is a social "I follow this community" bookmark a user can carry
 * into communities they've never been granted roster access to, and using
 * it here let a non-member see gated channel rows while some genuine roster
 * members (never having follow-set-joined) saw a locked-down zone. "Roster =
 * truth": the owner (key-holding), OR the moderated community's root-group
 * roster, OR Concord area membership — the same three signals
 * `shouldShowChannelsTab` already uses for the legacy 'channels' tab's own
 * visibility. An open community has neither a roster pointer nor a Concord
 * pointer, so `rosterIsMember`/`concordIsMember` both stay false harmlessly
 * and only `isOwner` can flip this true for it — same as before this fix,
 * since `buildSidebarZones` also ORs its own `isOwner` in independently.
 *
 * @param {{isOwner: boolean, rosterIsMember: boolean, concordIsMember: boolean}} args
 * @returns {boolean}
 */
export function resolveZoneMembership({ isOwner, rosterIsMember, concordIsMember }) {
  return isOwner || rosterIsMember || concordIsMember;
}
